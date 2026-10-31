const { expect } = require('chai');
const { checkExplanation, CHECKS } = require('../../src/lib/explanation-checks');
const { rankAndExplainGrantRows } = require('../../src/lib/groundedMatchExplanations');
const manifest = require('../../src/lib/semanticModelManifest.json');

// a fake embedder with the pinned manifest, so these run without the real model
const embedder = () => ({
    manifest,
    async embed(texts) {
        return texts.map(() => ({ vector: [1, ...Array(383).fill(0)], tokenCount: 8, truncated: false }));
    },
});
const profile = {
    id: 1,
    organizationId: 0,
    version: 1,
    jurisdiction: {
        type: 'city', name: 'Test City', stateCode: 'FL', countyName: null,
    },
    population: 42000,
    focusAreas: ['stormwater', 'flood prevention'],
    staffingCapacity: { level: 'limited', fullTimeEquivalent: 1, notes: null },
    matchingFunds: { available: false, maximumAmountCents: null, notes: null },
};
const row = (id, changes = {}) => ({
    grant_id: String(id),
    revision_id: 5,
    title: 'Stormwater drainage',
    description: 'Reduce urban flooding with stormwater drainage improvements. Applicants must be located in the Gulf region.',
    opportunity_status: 'posted',
    close_date: '2026-11-30',
    eligibility_codes: '02',
    cost_sharing: 'No',
    ...changes,
});

describe('explanation-checks', () => {
    let rows;
    let explained;
    const copy = (value) => JSON.parse(JSON.stringify(value));

    before(async () => {
        // one ranked grant with a review warning, one blocked by required cost share
        rows = [row(1), row(2, { cost_sharing: 'Yes' })];
        const out = await rankAndExplainGrantRows(profile, rows, { asOfDate: '2026-10-25', expectedProfileVersion: 1, embedder: embedder() });
        explained = out.results;
    });

    it('passes real C-10 output for a ranked grant and a blocked grant', () => {
        expect(explained.map((r) => r.disposition).sort()).to.deep.equal(['blocked', 'reviewRequired']);
        explained.forEach((result) => {
            expect(checkExplanation(result, rows.find((r) => Number(r.grant_id) === result.grantId))).to.deep.equal([]);
        });
    });

    it('describes every check code', () => {
        expect(Object.keys(CHECKS)).to.have.length(11);
    });

    // tampering with good output one way at a time, each should trip exactly the matching check
    const ranked = () => copy(explained.find((r) => r.rank !== null));
    const blocked = () => copy(explained.find((r) => r.disposition === 'blocked'));
    const listing = (result) => result.explanationDetails.evidence.find((e) => e.kind === 'listingText');
    const tampered = {
        CLAIM_HAS_EVIDENCE: [ranked, (r) => { r.explanationDetails.claims[0].evidenceIds = []; }],
        EVIDENCE_RESOLVES: [ranked, (r) => { r.explanationDetails.claims[0].evidenceIds = ['made-up']; }],
        EXCERPT_IN_SOURCE: [ranked, (r) => { listing(r).excerpt = 'words the listing never said'; }],
        EXCERPT_LENGTH: [ranked, (r) => { const e = listing(r); e.excerpt += 'x'.repeat(250); }],
        SCORE_MATCHES: [ranked, (r) => { r.score += 0.1; }],
        SCREENING_MATCHES: [ranked, (r) => { r.explanationDetails.evidence.find((e) => e.id === 'screening').disposition = 'eligible'; }],
        BLOCKERS_EXPLAINED: [blocked, (r) => { r.explanationDetails.claims = r.explanationDetails.claims.filter((c) => c.code !== 'HARD_BLOCKER'); }],
        WARNINGS_EXPLAINED: [ranked, (r) => { r.explanationDetails.claims = r.explanationDetails.claims.filter((c) => c.code !== 'REVIEW_WARNING'); }],
        BLOCKED_NOT_SCORED: [blocked, (r) => { r.rank = 3; }],
        MARKED_UNVERIFIED: [ranked, (r) => { r.explanationDetails.verificationStatus = 'verified'; }],
        NO_OVERCLAIM: [ranked, (r) => { r.explanationDetails.claims[0].text = 'This city is eligible for the grant.'; }],
    };

    Object.entries(tampered).forEach(([code, [pick, tamper]]) => {
        it(`catches ${code}`, () => {
            const result = pick();
            tamper(result);
            const source = rows.find((r) => Number(r.grant_id) === result.grantId);
            expect(checkExplanation(result, source)).to.include(code);
        });
    });
});
