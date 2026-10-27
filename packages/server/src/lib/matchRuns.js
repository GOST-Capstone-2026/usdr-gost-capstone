const { rankAndExplainGrantRows } = require('./groundedMatchExplanations');

const MAX_CANDIDATES = 50;
const DEFAULT_LIMIT = 25;
const failure = (code, message, details = []) => Object.assign(new Error(message), { code, details });

function validateMatchRequest(body) {
    const details = [];
    const issue = (field, message) => details.push({ field, issue: message });
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
        throw failure('VALIDATION_ERROR', 'The request contains invalid fields.', [{ field: 'body', issue: 'must be an object' }]);
    }
    Object.keys(body).forEach((key) => {
        if (!['profileId', 'profileVersion', 'candidateGrantIds', 'limit'].includes(key)) issue(key, 'is not allowed');
    });
    ['profileId', 'profileVersion'].forEach((key) => {
        if (!Number.isSafeInteger(body[key]) || body[key] < 1 || body[key] > 2147483647) issue(key, 'must be a positive supported integer');
    });
    const limit = body.limit === undefined ? DEFAULT_LIMIT : body.limit;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_CANDIDATES) issue('limit', `must be between 1 and ${MAX_CANDIDATES}`);
    if (body.candidateGrantIds !== undefined) {
        const ids = body.candidateGrantIds;
        if (!Array.isArray(ids) || !ids.length || ids.length > MAX_CANDIDATES || ids.length > limit
            || ids.some((value) => !Number.isSafeInteger(value) || value < 0)
            || new Set(ids).size !== ids.length) {
            issue('candidateGrantIds', 'must contain unique nonnegative integer IDs and fit within the candidate limit');
        }
    }
    if (details.length) throw failure('VALIDATION_ERROR', 'The request contains invalid fields.', details);
    return {
        profileId: body.profileId,
        profileVersion: body.profileVersion,
        limit,
        ...(body.candidateGrantIds === undefined ? {} : { candidateGrantIds: [...body.candidateGrantIds].sort((a, b) => a - b) }),
    };
}

function screeningDate(date) {
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(date);
    const part = (type) => parts.find((item) => item.type === type).value;
    return `${part('year')}-${part('month')}-${part('day')}`;
}

function createMatchRunner({
    repository, createEmbedder, ranker = rankAndExplainGrantRows, now = () => new Date(),
}) {
    let busy = false;
    return async (access, body) => {
        const request = validateMatchRequest(body);
        if (busy) throw failure('MATCHING_BUSY', 'The local matcher is busy. Try again shortly.');
        busy = true;
        try {
            const { profile, rows, selection } = await repository.loadInputs(access, request);
            if (!Array.isArray(profile.focusAreas)) throw failure('INVALID_PROFILE', 'Review the saved organization profile before matching.');
            if (!profile.focusAreas.length) throw failure('PROFILE_FOCUS_REQUIRED', 'Add a saved focus area before matching.');
            const startedAt = now();
            const embedder = await createEmbedder(); // Cached pinned assets only; never download in an HTTP request.
            let result;
            try {
                result = await ranker(profile, rows, {
                    asOfDate: screeningDate(startedAt), expectedProfileVersion: request.profileVersion, embedder,
                });
            } finally {
                await embedder.dispose();
            }
            const reviewRequired = result.results.some((row) => row.explanationDetails.verificationStatus === 'unverified');
            return await repository.save(access, request, {
                result: { ...result, candidateSelection: selection },
                inputs: { profile, rows },
                startedAt,
                completedAt: now(),
                status: reviewRequired ? 'reviewRequired' : 'completed',
            });
        } finally {
            busy = false;
        }
    };
}

module.exports = {
    createMatchRunner, validateMatchRequest, screeningDate, failure, MAX_CANDIDATES, DEFAULT_LIMIT,
};
