const { expect } = require('chai');
const fixtures = require('../../evaluation/matching-fixtures.json');
const demoData = require('../../seeds/demo/opportunities.json');
const { validateProfile } = require('../../src/lib/complianceProfile');
const { DISPOSITIONS } = require('../../src/lib/evaluation-metrics');
const { buildRow, runEvaluation, statusOn } = require('../../src/scripts/evaluateMatching');

const BLOCKER_CODES = ['APPLICANT_TYPE_UNSUPPORTED', 'DEADLINE_PASSED', 'MATCHING_FUNDS_INSUFFICIENT',
    'MATCHING_FUNDS_UNAVAILABLE', 'OPPORTUNITY_CLOSED'];
const NOT_MODELED = ['GEOGRAPHY', 'APPLICANT_TYPE_IN_NOTICE_TEXT'];

// checking the fixture file itself, so a bad edit during review gets caught before the numbers do
describe('matching evaluation fixtures', () => {
    const grantIds = new Set(demoData.opportunities.map((o) => String(o.opportunity.id)));
    const scenarios = new Map(fixtures.scenarios.map((s) => [s.id, s]));

    it('uses profiles that pass the shared profile validation', () => {
        Object.entries(fixtures.profiles).forEach(([key, profile]) => {
            const {
                id, organizationId, version, ...body
            } = profile;
            expect(validateProfile({ expectedVersion: version, ...body }), key).to.deep.equal([]);
            expect(version, key).to.be.at.least(1);
        });
    });

    it('has one case per scenario, profile and grant, all pointing at things that exist', () => {
        const ids = fixtures.cases.map((c) => c.id);
        expect(new Set(ids).size).to.equal(ids.length);
        fixtures.cases.forEach((c) => {
            expect(c.id).to.equal(`${c.scenario}/${c.profile}/${c.grantId}`);
            expect(scenarios.has(c.scenario), c.id).to.be.true;
            expect(fixtures.profiles, c.id).to.have.property(c.profile);
            expect(grantIds.has(c.grantId), c.id).to.be.true;
        });
    });

    it('only uses known labels, and blocked always comes with a blocker code', () => {
        fixtures.cases.forEach((c) => {
            const { expected } = c;
            expect(DISPOSITIONS, c.id).to.include(expected.disposition);
            expected.blockers.forEach((code) => expect(BLOCKER_CODES, c.id).to.include(code));
            expected.notModeled.forEach((tag) => expect(NOT_MODELED, c.id).to.include(tag));
            expect(expected.disposition === 'blocked', c.id).to.equal(expected.blockers.length > 0);
            expect(expected.blockers, c.id).to.deep.equal([...expected.blockers].sort());
            expect(c.rationale, c.id).to.be.a('string').and.not.be.empty;
            expect(['draft', 'reviewed'], c.id).to.include(c.review.status);
        });
    });

    it('labels relevance 0-2 for every case in a ranking scenario', () => {
        fixtures.cases.filter((c) => scenarios.get(c.scenario).evaluateRanking).forEach((c) => {
            expect([0, 1, 2], c.id).to.include(c.expected.relevance);
        });
    });

    it('gives every ranking profile at least one relevant grant that is not blocked', () => {
        const rankingCases = fixtures.cases.filter((c) => scenarios.get(c.scenario).evaluateRanking);
        Object.keys(fixtures.profiles).forEach((profile) => {
            const hits = rankingCases.filter((c) => c.profile === profile && c.expected.disposition !== 'blocked'
                && c.expected.relevance > 0);
            expect(hits.length, profile).to.be.at.least(1);
        });
    });
});

describe('evaluateMatching', () => {
    const event = demoData.opportunities.find((o) => o.opportunity.id === '364009');

    it('derives status from the scenario date, not today', () => {
        expect(buildRow(event, '2026-10-20').opportunity_status).to.equal('posted');
        // ingest marks a grant closed on its closing day
        expect(buildRow(event, '2026-11-16').opportunity_status).to.equal('closed');
        expect(buildRow(event, '2026-12-16').opportunity_status).to.equal('archived');
        expect(statusOn({ open_date: '2026-11-01', close_date: '2026-12-01' }, '2026-10-01')).to.equal('forecasted');
    });

    it('keeps the text grant id that ingest stores (the ranker accepts it since C-09 v2)', () => {
        expect(buildRow(event, '2026-10-20').grant_id).to.equal('364009');
    });

    it('runs the screening part end to end without a model', async () => {
        const report = await runEvaluation();
        expect(report.ranking).to.equal(null);
        expect(report.screening.disposition.cases).to.equal(fixtures.cases.length);
        expect(report.review.total).to.equal(fixtures.cases.length);
        // a truly blocked grant reaching ranking is the worst failure, so pinning it here
        expect(report.screening.disposition.missedBlockRate).to.equal(0);
    });

    it('feeds ranking only through the injected ranker and reports leaks', async () => {
        const fx = {
            ...fixtures,
            scenarios: [{ id: 's', asOfDate: '2026-10-20', evaluateRanking: true }],
            cases: [
                {
                    id: 's/tx-city-justice/364037',
                    scenario: 's',
                    profile: 'tx-city-justice',
                    grantId: '364037',
                    expected: {
                        disposition: 'reviewRequired', blockers: [], notModeled: [], relevance: 2,
                    },
                    rationale: 'x',
                    review: { status: 'draft' },
                },
                {
                    id: 's/tx-city-justice/364009',
                    scenario: 's',
                    profile: 'tx-city-justice',
                    grantId: '364009',
                    expected: {
                        disposition: 'blocked', blockers: ['MATCHING_FUNDS_UNAVAILABLE'], notModeled: [], relevance: 0,
                    },
                    rationale: 'x',
                    review: { status: 'draft' },
                },
            ],
        };
        // fake ranker that wrongly ranks the blocked grant first
        const rankGrantRows = async (profile, rows) => ({
            model: 'fake',
            inputHash: 'h',
            results: rows.map((r) => ({ grantId: r.grant_id, rank: r.grant_id === '364009' ? 1 : 2, score: 0.5 })),
        });
        const report = await runEvaluation(fx, demoData, { embedder: {}, rankGrantRows });
        expect(report.ranking.blockedLeaks).to.equal(1);
        expect(report.ranking.runs[0].metrics.reciprocalRank).to.equal(0.5);
    });
});
