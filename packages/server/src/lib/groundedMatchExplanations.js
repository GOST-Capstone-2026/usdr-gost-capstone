const { createHash } = require('crypto');
const {
    rankGrantRows, plainText, sourceText, TEXT_VERSION,
} = require('./semanticRanking');

const EXPLANATION_VERSION = 'grounded-match-v1';
const EXPLANATION_METHOD = 'extractive-template';
const MAX_EXCERPT_CHARS = 240;
const STOP_WORDS = new Set(['and', 'the', 'for', 'with', 'from', 'into', 'that', 'this', 'are', 'our', 'its']);

function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
}

function snapshot(value) {
    try {
        // Preserve invalid numeric values for the ranker's validation, rather than changing NaN to null.
        return global.structuredClone(value);
    } catch (error) {
        throw Object.assign(new Error('Explanation inputs must be cloneable profile and grant data.'), { code: 'INVALID_EXPLANATION_INPUT' });
    }
}

function excerpt(text, focusAreas) {
    const terms = new Set((focusAreas.join(' ').toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [])
        .filter((term) => !STOP_WORDS.has(term)));
    // Lexical overlap selects display context only. It is not an attribution of the embedding score.
    const match = [...text.matchAll(/[\p{L}\p{N}]+/gu)].find((word) => terms.has(word[0].toLowerCase()));
    let startOffset = Math.max(0, (match?.index ?? 0) - 60);
    const lowSurrogate = (index) => text.charCodeAt(index) >= 0xDC00 && text.charCodeAt(index) <= 0xDFFF;
    if (lowSurrogate(startOffset)) startOffset -= 1;
    let endOffset = Math.min(text.length, startOffset + MAX_EXCERPT_CHARS);
    if (lowSurrogate(endOffset)) endOffset -= 1;
    return {
        excerpt: text.slice(startOffset, endOffset),
        startOffset,
        endOffset,
        truncated: startOffset > 0 || endOffset < text.length,
    };
}

function explainResult(profile, row, result, run) {
    const focusAreas = [...new Set(profile.focusAreas.map(plainText).filter(Boolean))].sort();
    const source = sourceText(row);
    const evidence = [{
        id: 'profile-focus',
        kind: 'profileField',
        field: 'focusAreas',
        profileId: run.profileId,
        profileVersion: run.profileVersion,
        normalizationVersion: TEXT_VERSION,
        value: focusAreas,
    }, {
        id: 'screening',
        kind: 'screeningAndReviewResult',
        grantId: result.grantId,
        screenedOn: run.screenedOn,
        screeningMethodVersion: result.screeningMethodVersion,
        rankingMethodVersion: result.methodVersion,
        sourceAvailability: { title: Boolean(source.title), description: Boolean(source.description) },
        disposition: result.disposition,
        blockers: snapshot(result.blockers),
        uncertainties: [...result.uncertainties],
    }];
    const claims = [];
    const claim = (code, text, evidenceIds) => claims.push({ code, text, evidenceIds });
    const limitations = [
        'Relevance is not eligibility, funding probability, or confidence. No per-word score attribution is claimed.',
        'Geographic and notice-specific eligibility require full-notice and proposed-project review.',
        'Listing excerpts are not PDF/page citations. No verified document or page was supplied.',
    ];

    if (result.disposition === 'blocked') {
        result.blockers.forEach((blocker) => claim('HARD_BLOCKER', `Not ranked: ${blocker.message}`, ['screening']));
    } else if (result.score === null) {
        claim('UNRANKED', 'Not ranked because the available listing has no title or description text.', ['screening']);
    } else {
        evidence.push({
            id: 'ranking',
            kind: 'rankingResult',
            grantId: result.grantId,
            score: result.score,
            rank: result.rank,
            methodVersion: result.methodVersion,
            model: result.model,
            inputHash: run.inputHash,
        });
        claim(
            'RELEVANCE_METHOD',
            `Semantic relevance score ${result.score.toFixed(6)} compares profile focus areas with available listing title/description. This is not an eligibility decision or funding probability.`,
            ['ranking', 'profile-focus', ...['title', 'description'].filter((field) => source[field]).map((field) => `listing-${field}`)],
        );
    }
    claim('PROFILE_FOCUS', `Profile focus areas: ${JSON.stringify(focusAreas)}.`, ['profile-focus']);

    ['title', 'description'].forEach((field) => {
        if (!source[field]) return;
        const id = `listing-${field}`;
        const raw = row.raw_body_json?.opportunity;
        const sourceField = raw && Object.prototype.hasOwnProperty.call(raw, field) ? `raw_body_json.opportunity.${field}` : field;
        const item = {
            id,
            kind: 'listingText',
            grantId: result.grantId,
            sourceRevision: result.sourceRevision,
            field: sourceField,
            normalizedField: field,
            normalizationVersion: TEXT_VERSION,
            sourceTextHash: result.sourceTextHash,
            ...excerpt(source[field], focusAreas),
        };
        evidence.push(item);
        const punctuation = /[.!?]$/.test(item.excerpt) ? '' : '.';
        claim(
            field === 'title' ? 'LISTING_TITLE' : 'LISTING_EXCERPT',
            `Listing ${field}${item.truncated ? ' excerpt (partial)' : ''}: ${JSON.stringify(item.excerpt)}${punctuation}`,
            [id],
        );
    });
    if (result.disposition !== 'blocked') {
        claim('SCREENING_SCOPE', 'The implemented checks found no hard blocker. This does not certify full notice eligibility.', ['screening']);
    }
    result.uncertainties.forEach((warning) => claim('REVIEW_WARNING', `Review note: ${warning}`, ['screening']));
    if (result.sourceRevision === null) limitations.push('The listing revision is unavailable; verify the current source before relying on these excerpts.');
    if (run.profileId === null) limitations.push('The profile ID is unavailable; the caller must load an authorized saved profile before exposing results.');

    const details = {
        version: EXPLANATION_VERSION,
        method: EXPLANATION_METHOD,
        model: null,
        verificationStatus: 'unverified',
        provenance: {
            inputHash: run.inputHash,
            profileId: run.profileId,
            profileVersion: run.profileVersion,
            organizationId: run.organizationId,
            grantId: result.grantId,
            sourceRevision: result.sourceRevision,
            sourceTextHash: result.sourceTextHash,
            screenedOn: run.screenedOn,
        },
        claims,
        evidence,
        limitations,
    };
    return {
        ...result,
        explanation: `${claims.map(({ text }) => text).join(' ')} Unverified source-linked explanation; review the full notice.`,
        explanationDetails: details,
    };
}

async function rankAndExplainGrantRows(profile, rows, options = {}) {
    // Both ranking and explanations use these same snapshots, including across asynchronous inference.
    const savedProfile = snapshot(profile);
    const savedRows = snapshot(rows);
    const run = await rankGrantRows(savedProfile, savedRows, options);
    // The ranker has validated and canonicalized every ID before this map is used.
    // Match the ranker's JSON snapshot representation (including Date values returned by a repository).
    const byId = new Map(JSON.parse(JSON.stringify(savedRows)).map((row) => [Number(row.grant_id), row]));
    const results = run.results.map((result) => explainResult(savedProfile, byId.get(result.grantId), result, run));
    const explanationHash = createHash('sha256').update(JSON.stringify(canonical({
        inputHash: run.inputHash, version: EXPLANATION_VERSION, results: results.map(({ explanationDetails }) => explanationDetails),
    }))).digest('hex');
    return {
        ...run, results, explanationVersion: EXPLANATION_VERSION, explanationMethod: EXPLANATION_METHOD, explanationHash,
    };
}

module.exports = { rankAndExplainGrantRows, EXPLANATION_VERSION, MAX_EXCERPT_CHARS };
