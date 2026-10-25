const { createHash } = require('crypto');
const { validateProfile } = require('./complianceProfile');
const { screenGrantRow } = require('./grantsEligibilityAdapter');
const { isCalendarDate } = require('./eligibilityBlockers');
const manifest = require('./semanticModelManifest.json');

const METHOD_VERSION = 'matcher-minilm-v2';
const TEXT_VERSION = 'focus-title-description-v1';
function canonical(value) {
    if (Array.isArray(value)) return value.map(canonical);
    if (value && typeof value === 'object') {
        return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])]));
    }
    return value;
}
const digest = (value) => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
const inputError = (code, message) => Object.assign(new Error(message), { code });

function normalizeGrantId(value) {
    // PostgreSQL/ingest IDs may be decimal text. Never coerce null, booleans, fractions, or unsafe integers.
    const normalized = typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : value;
    return Number.isSafeInteger(normalized) && normalized >= 0 ? normalized : null;
}

function plainText(value) {
    if (typeof value !== 'string') return '';
    return value.normalize('NFKC').replace(/<[^>]*>/g, ' ').replace(/&nbsp;|&#160;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim();
}

function cosineScore(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== manifest.dimensions || b.length !== a.length
        || [...a, ...b].some((value) => typeof value !== 'number' || !Number.isFinite(value))) {
        throw inputError('INVALID_EMBEDDING', 'Expected finite 384-dimensional vectors from the pinned model.');
    }
    const normA = Math.hypot(...a);
    const normB = Math.hypot(...b);
    if (!Number.isFinite(normA) || !Number.isFinite(normB) || !normA || !normB) {
        throw inputError('INVALID_EMBEDDING', 'Zero or overflowing vectors cannot be scored.');
    }
    const cosine = a.reduce((sum, value, index) => sum + (value / normA) * (b[index] / normB), 0);
    return Number(Math.max(0, Math.min(1, cosine)).toFixed(6));
}

function profileInput(profile) {
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)
        || !Number.isSafeInteger(profile.version) || profile.version < 1) {
        throw inputError('INVALID_PROFILE', 'Use a validated saved profile with a positive version.');
    }
    const body = { expectedVersion: profile.version };
    ['jurisdiction', 'population', 'focusAreas', 'staffingCapacity', 'matchingFunds'].forEach((key) => { body[key] = profile[key]; });
    if (validateProfile(body).length) throw inputError('INVALID_PROFILE', 'The profile does not meet the shared validation contract.');
    const query = [...new Set(profile.focusAreas.map(plainText).filter(Boolean))].sort().join('; ');
    if (!query) throw inputError('PROFILE_FOCUS_REQUIRED', 'Add at least one focus area before semantic ranking.');
    return { body, query };
}

function sourceText(row) {
    const source = row.raw_body_json?.opportunity;
    const field = (key) => plainText(source && Object.prototype.hasOwnProperty.call(source, key) ? source[key] : row[key]);
    const title = field('title');
    const description = field('description');
    if (title.length > 32000 || description.length > 32000) throw inputError('INPUT_TOO_LARGE', 'Opportunity text exceeds the baseline size limit.');
    const text = [title, description].filter(Boolean).join('\n');
    if (text.length > 64000) throw inputError('INPUT_TOO_LARGE', 'Combined opportunity text exceeds the baseline size limit.');
    return { title, description, text };
}

async function rankGrantRows(profile, rows, { asOfDate, expectedProfileVersion, embedder } = {}) {
    if (!isCalendarDate(asOfDate)) throw inputError('INVALID_DATE', 'Supply a valid explicit YYYY-MM-DD screening date.');
    const { body, query } = profileInput(profile);
    if (!Number.isSafeInteger(expectedProfileVersion) || expectedProfileVersion !== profile.version) {
        throw inputError('VERSION_CONFLICT', 'The requested profile version does not match the loaded profile.');
    }
    if (!Array.isArray(rows) || rows.length > 250
        || rows.some((row) => !row || typeof row !== 'object' || Array.isArray(row)
            || normalizeGrantId(row.grant_id) === null)) {
        throw inputError('INVALID_CANDIDATES', 'Supply at most 250 stored grant rows with nonnegative safe integer or decimal-text IDs.');
    }
    const normalizedRows = rows.map((row) => ({ ...row, grant_id: normalizeGrantId(row.grant_id) }));
    if (new Set(normalizedRows.map((row) => row.grant_id)).size !== rows.length) {
        throw inputError('DUPLICATE_CANDIDATE', 'Each candidate grant ID must identify exactly one source revision.');
    }
    if (!embedder || typeof embedder.embed !== 'function' || !embedder.manifest
        || digest(embedder.manifest) !== digest(manifest)) {
        throw inputError('MODEL_RUNTIME_MISMATCH', 'Use the pinned local model manifest; do not mix models or revisions.');
    }
    // Clone caller-owned inputs before the first await so later UI/caller changes cannot alter an active run.
    const snapshots = JSON.parse(JSON.stringify(normalizedRows)).sort((a, b) => a.grant_id - b.grant_id);
    const storedProfile = JSON.parse(JSON.stringify({
        ...body, version: profile.version, id: profile.id ?? null, organizationId: profile.organizationId ?? null,
    }));
    const entries = snapshots.map((row) => {
        const source = sourceText(row);
        const screening = screenGrantRow(storedProfile, row, { asOfDate });
        if (!screening.blockers.length && (!source.title || !source.description)) {
            screening.uncertainties.push('Opportunity title or description is missing; semantic relevance is based only on available text.');
            screening.disposition = 'reviewRequired';
        }
        return { row, source, screening };
    });
    const rankable = entries.filter(({ source, screening }) => screening.disposition !== 'blocked' && source.text);
    let embeddings = [];
    if (rankable.length) {
        // Blocked grant text is never submitted to the model, even if it appears highly relevant.
        embeddings = await embedder.embed([query, ...rankable.map(({ source }) => source.text)]);
        if (!Array.isArray(embeddings) || embeddings.length !== rankable.length + 1) {
            throw inputError('INVALID_EMBEDDING', 'The embedding output count does not match the requested inputs.');
        }
        embeddings.forEach((item) => {
            cosineScore(item?.vector, item?.vector);
            if (typeof item.truncated !== 'boolean' || !Number.isInteger(item.tokenCount)
                || item.tokenCount < 2 || item.tokenCount > manifest.maxTokens) {
                throw inputError('INVALID_EMBEDDING', 'Embedding token metadata is invalid.');
            }
        });
    }
    const scores = new Map(rankable.map((entry, index) => [entry.row.grant_id, {
        score: cosineScore(embeddings[0].vector, embeddings[index + 1].vector),
        truncated: embeddings[0].truncated || embeddings[index + 1].truncated,
    }]));
    const model = `${manifest.modelId}@${manifest.revision}:q8-wasm`;
    const results = entries.map(({ row, source, screening }) => {
        const similarity = scores.get(row.grant_id);
        const result = {
            ...screening,
            methodVersion: METHOD_VERSION,
            screeningMethodVersion: screening.methodVersion,
            model,
            textVersion: TEXT_VERSION,
            sourceRevision: row.revision_id ?? null,
            sourceTextHash: digest({ title: source.title, description: source.description }),
            score: similarity?.score ?? null,
        };
        if (similarity) {
            if (similarity.truncated) {
                result.uncertainties.push('Model input exceeded 256 tokens and was truncated; review the full notice.');
                result.disposition = 'reviewRequired';
            }
            result.scoreFactors = [{
                code: 'FOCUS_AREA_MATCH',
                label: 'Semantic focus-area alignment',
                value: similarity.score,
                weight: 1,
                explanation: 'Cosine similarity of profile focus areas and opportunity title/description; not an eligibility decision or funding probability.',
            }];
            result.explanation = 'Semantic relevance baseline only. Grounded match explanations are a separate C-10 step; review all eligibility warnings.';
        } else if (result.disposition !== 'blocked') {
            result.explanation = 'No opportunity text is available for semantic ranking. Review the source notice.';
        }
        return result;
    }).sort((a, b) => {
        if ((a.score === null) !== (b.score === null)) return a.score === null ? 1 : -1;
        return (b.score ?? 0) - (a.score ?? 0) || a.grantId - b.grantId;
    });
    let rank = 0;
    results.forEach((result) => { if (result.score !== null) { rank += 1; result.rank = rank; } });
    return {
        methodVersion: METHOD_VERSION,
        textVersion: TEXT_VERSION,
        model,
        modelManifest: JSON.parse(JSON.stringify(manifest)),
        screenedOn: asOfDate,
        profileVersion: storedProfile.version,
        profileId: storedProfile.id,
        organizationId: storedProfile.organizationId,
        inputHash: digest({
            method: METHOD_VERSION, textVersion: TEXT_VERSION, manifest, asOfDate, profile: storedProfile, rows: snapshots,
        }),
        candidateCount: results.length,
        rankedCount: rank,
        blockedCount: results.filter((result) => result.disposition === 'blocked').length,
        results,
    };
}

module.exports = {
    rankGrantRows, cosineScore, plainText, sourceText, METHOD_VERSION, TEXT_VERSION,
};
