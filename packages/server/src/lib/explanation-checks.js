// checking that C-10 match explanations are honest, used by the A-14 snapshot.
// e.g. every quote really comes from the listing and every claim points at real evidence.
// checking ai-written text is a separate task (A-16).
const { sourceText } = require('./semanticRanking');

const MAX_EXCERPT_CHARS = 240;
// wording that would turn a screening pass into an eligibility promise
const OVERCLAIM = /\b(?:is|are) eligible\b|\bqualifies\b|\bguarantee/i;

const CHECKS = {
    CLAIM_HAS_EVIDENCE: 'every claim lists at least one evidence id',
    EVIDENCE_RESOLVES: 'every evidence id a claim uses exists in the same result',
    EXCERPT_IN_SOURCE: 'every listing excerpt is the exact slice of the listing text at its offsets',
    EXCERPT_LENGTH: 'every listing excerpt is at most 240 characters',
    SCORE_MATCHES: 'the ranking evidence repeats the actual score and rank',
    SCREENING_MATCHES: 'the screening evidence repeats the actual disposition, blockers and warnings',
    BLOCKERS_EXPLAINED: 'every blocker has its own HARD_BLOCKER claim',
    WARNINGS_EXPLAINED: 'every review warning has its own REVIEW_WARNING claim',
    BLOCKED_NOT_SCORED: 'a blocked grant has no rank and no relevance claim',
    MARKED_UNVERIFIED: 'the explanation is marked unverified and names no text model',
    NO_OVERCLAIM: 'no claim says the organization is eligible or qualifies',
};

/**
 * checks one explained result against the stored row it came from.
 * @param {object} result one item of rankAndExplainGrantRows(...).results
 * @param {object} row the stored grant row that produced it
 * @returns {string[]} codes of the checks that failed, empty when everything holds
 */
function checkExplanation(result, row) {
    const failed = new Set();
    const details = result.explanationDetails || {};
    const claims = details.claims || [];
    const evidence = details.evidence || [];
    const byId = new Map(evidence.map((e) => [e.id, e]));
    const source = sourceText(JSON.parse(JSON.stringify(row)));
    const codes = (code) => claims.filter((c) => c.code === code);

    claims.forEach((c) => {
        if (!Array.isArray(c.evidenceIds) || !c.evidenceIds.length) failed.add('CLAIM_HAS_EVIDENCE');
        (c.evidenceIds || []).forEach((id) => { if (!byId.has(id)) failed.add('EVIDENCE_RESOLVES'); });
        if (OVERCLAIM.test(c.text)) failed.add('NO_OVERCLAIM');
    });

    evidence.filter((e) => e.kind === 'listingText').forEach((e) => {
        const text = source[e.normalizedField] || '';
        if (text.slice(e.startOffset, e.endOffset) !== e.excerpt) failed.add('EXCERPT_IN_SOURCE');
        if (e.excerpt.length > MAX_EXCERPT_CHARS) failed.add('EXCERPT_LENGTH');
    });

    const ranking = byId.get('ranking');
    if (result.disposition === 'blocked') {
        if (result.rank !== null || ranking || codes('RELEVANCE_METHOD').length) failed.add('BLOCKED_NOT_SCORED');
        if (codes('HARD_BLOCKER').length !== result.blockers.length) failed.add('BLOCKERS_EXPLAINED');
    } else if (result.score !== null && (!ranking || ranking.score !== result.score || ranking.rank !== result.rank)) {
        failed.add('SCORE_MATCHES');
    }

    const screening = byId.get('screening');
    if (!screening || screening.disposition !== result.disposition
        || JSON.stringify(screening.blockers) !== JSON.stringify(result.blockers)
        || JSON.stringify(screening.uncertainties) !== JSON.stringify(result.uncertainties)) {
        failed.add('SCREENING_MATCHES');
    }
    const warningTexts = codes('REVIEW_WARNING').map((c) => c.text);
    if (result.uncertainties.some((u) => !warningTexts.some((t) => t.includes(u)))) failed.add('WARNINGS_EXPLAINED');

    if (details.verificationStatus !== 'unverified' || details.model !== null) failed.add('MARKED_UNVERIFIED');
    return [...failed].sort();
}

module.exports = { checkExplanation, CHECKS };
