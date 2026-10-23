const { expect } = require('chai');
const { rankGrantRows, cosineScore, plainText } = require('../../src/lib/semanticRanking');
const manifest = require('../../src/lib/semanticModelManifest.json');

const profile = () => ({
    id: 10,
    organizationId: 0,
    version: 2,
    jurisdiction: {
        type: 'city', name: 'Test City', stateCode: 'FL', countyName: null,
    },
    population: 42000,
    focusAreas: ['stormwater', 'flood prevention'],
    staffingCapacity: { level: 'limited', fullTimeEquivalent: 1, notes: null },
    matchingFunds: { available: false, maximumAmountCents: null, notes: null },
});
const row = (id = 1, changes = {}) => ({
    grant_id: id,
    revision_id: 5,
    title: 'Stormwater drainage',
    description: 'Reduce urban flooding with drainage improvements.',
    opportunity_status: 'posted',
    close_date: '2026-11-30',
    eligibility_codes: '02',
    cost_sharing: 'No',
    ...changes,
});
const vector = (a, b = 0) => [a, b, ...Array(manifest.dimensions - 2).fill(0)];
const options = { asOfDate: '2026-10-23', expectedProfileVersion: 2 };

// Synthetic vectors isolate ranking mechanics. Real-model verification is the separate C-09 rehearsal.
function fakeEmbedder() {
    return {
        manifest: JSON.parse(JSON.stringify(manifest)),
        calls: [],
        async embed(texts) {
            this.calls.push([...texts]);
            return texts.map((text) => ({
                vector: text.includes('Library') ? vector(0, 1) : vector(1), tokenCount: 8, truncated: false,
            }));
        },
    };
}

async function failure(action, code) {
    let caught;
    try { await action(); } catch (error) { caught = error; }
    expect(caught, `expected ${code}`).to.be.instanceOf(Error);
    expect(caught.code).to.equal(code);
}

describe('C-09 semantic ranking mechanics', () => {
    it('ranks semantic scores without allowing them to override hard blockers', async () => {
        const embedder = fakeEmbedder();
        const result = await rankGrantRows(profile(), [
            row(1), row(2, { opportunity_status: 'closed', title: 'Blocked stormwater grant' }),
            row(3, { title: 'Library books' }), row(4, { eligibility_codes: '99' }),
            row(5, { title: '', description: '' }),
        ], { ...options, embedder });
        expect(result).to.include({
            candidateCount: 5, rankedCount: 3, blockedCount: 1, profileVersion: 2, organizationId: 0,
        });
        expect(result.results.map(({ grantId }) => grantId)).to.deep.equal([1, 4, 3, 2, 5]);
        expect(result.results.slice(0, 3).map(({ rank }) => rank)).to.deep.equal([1, 2, 3]);
        expect(embedder.calls[0]).to.have.length(4);
        expect(embedder.calls[0].some((text) => text.includes('Blocked stormwater grant'))).to.equal(false);
        const blocked = result.results.find(({ grantId }) => grantId === 2);
        expect(blocked).to.include({ disposition: 'blocked', rank: null, score: null });
        expect(blocked.blockers.map(({ code }) => code)).to.include('OPPORTUNITY_CLOSED');
        const review = result.results.find(({ grantId }) => grantId === 4);
        expect(review).to.include({ disposition: 'reviewRequired', score: 1 });
        expect(review.uncertainties).not.to.be.empty;
        const missing = result.results.find(({ grantId }) => grantId === 5);
        expect(missing).to.include({ disposition: 'reviewRequired', rank: null, score: null });
    });

    it('retains every blocker without embedding unavailable-funds or unsupported applicants', async () => {
        const embedder = fakeEmbedder();
        const result = await rankGrantRows(profile(), [row(1, { cost_sharing: 'Yes', eligibility_codes: '12' })], { ...options, embedder });
        expect(embedder.calls).to.deep.equal([]);
        expect(result.results[0].blockers.map(({ code }) => code)).to.deep.equal([
            'APPLICANT_TYPE_UNSUPPORTED', 'MATCHING_FUNDS_UNAVAILABLE',
        ]);
        expect(result.results[0]).to.include({ rank: null, score: null });
    });

    it('uses numeric grant IDs as stable tie-breakers independently of candidate order', async () => {
        const first = await rankGrantRows(profile(), [row(10), row(2)], { ...options, embedder: fakeEmbedder() });
        const second = await rankGrantRows(profile(), [row(2), row(10)], { ...options, embedder: fakeEmbedder() });
        expect(first).to.deep.equal(second);
        expect(first.results.map(({ grantId }) => grantId)).to.deep.equal([2, 10]);
    });

    it('records date, profile/source versions, model revision, and source text hashes', async () => {
        const result = await rankGrantRows(profile(), [row()], { ...options, embedder: fakeEmbedder() });
        expect(result.screenedOn).to.equal(options.asOfDate);
        expect(result.modelManifest).to.deep.equal(manifest);
        expect(result.model).to.include(manifest.revision);
        expect(result.inputHash).to.match(/^[a-f0-9]{64}$/);
        expect(result.results[0]).to.include({ sourceRevision: 5, screeningMethodVersion: 'eligibility-v1', profileVersion: 2 });
        expect(result.results[0].sourceTextHash).to.match(/^[a-f0-9]{64}$/);
        expect(result.results[0].scoreFactors[0]).to.include({ code: 'FOCUS_AREA_MATCH', value: 1, weight: 1 });
    });

    it('changes the input hash when a source revision or profile content changes', async () => {
        const run = (p, rows) => rankGrantRows(p, rows, { ...options, embedder: fakeEmbedder() });
        const first = await run(profile(), [row()]);
        expect((await run(profile(), [row(1, { revision_id: 6 })])).inputHash).not.to.equal(first.inputHash);
        const changed = profile(); changed.focusAreas = ['parks'];
        expect((await run(changed, [row()])).inputHash).not.to.equal(first.inputHash);
    });

    it('canonicalizes object keys for reproducible input and model hashes', async () => {
        const first = await rankGrantRows(profile(), [row()], { ...options, embedder: fakeEmbedder() });
        const embedder = fakeEmbedder();
        embedder.manifest = Object.fromEntries(Object.entries(manifest).reverse());
        const reversedRow = Object.fromEntries(Object.entries(row()).reverse());
        expect(await rankGrantRows(profile(), [reversedRow], { ...options, embedder })).to.deep.equal(first);
    });

    it('does not mutate inputs and snapshots them before awaiting the model', async () => {
        const p = profile(); const rows = [row()];
        const before = JSON.stringify({ p, rows });
        const embedder = fakeEmbedder();
        const original = embedder.embed.bind(embedder);
        embedder.embed = async (texts) => {
            expect(JSON.stringify({ p, rows })).to.equal(before);
            const output = await original(texts);
            p.version = 99; rows[0].opportunity_status = 'closed';
            return output;
        };
        const result = await rankGrantRows(p, rows, { ...options, embedder });
        expect(result.profileVersion).to.equal(2);
        expect(result.results[0].disposition).to.equal('eligible');
    });

    it('prefers authoritative raw source text over contradictory legacy text', async () => {
        const embedder = fakeEmbedder();
        await rankGrantRows(profile(), [row(1, { raw_body_json: { opportunity: { title: 'Library source', description: '' } } })], { ...options, embedder });
        expect(embedder.calls[0][1]).to.equal('Library source');
    });

    it('keeps missing-description and truncation warnings visible', async () => {
        const embedder = fakeEmbedder();
        const original = embedder.embed.bind(embedder);
        embedder.embed = async (texts) => (await original(texts)).map((item) => ({ ...item, truncated: true }));
        const result = await rankGrantRows(profile(), [row(1, { description: '' })], { ...options, embedder });
        expect(result.results[0]).to.include({ disposition: 'reviewRequired', rank: 1 });
        expect(result.results[0].uncertainties).to.have.length(2);
    });

    it('handles an empty candidate list without calling the model', async () => {
        const embedder = fakeEmbedder();
        const result = await rankGrantRows(profile(), [], { ...options, embedder });
        expect(result).to.include({ candidateCount: 0, rankedCount: 0, blockedCount: 0 });
        expect(result.results).to.deep.equal([]);
        expect(embedder.calls).to.deep.equal([]);
    });

    it('propagates a model failure instead of fabricating zero scores', async () => {
        const embedder = fakeEmbedder();
        embedder.embed = async () => { throw Object.assign(new Error('offline failure'), { code: 'EMBEDDING_UNAVAILABLE' }); };
        await failure(() => rankGrantRows(profile(), [row()], { ...options, embedder }), 'EMBEDDING_UNAVAILABLE');
    });
});

describe('C-09 ranking input and output validation', () => {
    const run = (p, rows, changes = {}) => rankGrantRows(p, rows, { ...options, embedder: fakeEmbedder(), ...changes });
    [undefined, 1, '2', null].forEach((expectedProfileVersion) => {
        it(`rejects a missing/stale/noninteger profile version (${String(expectedProfileVersion)})`, async () => {
            await failure(() => run(profile(), [row()], { expectedProfileVersion }), 'VERSION_CONFLICT');
        });
    });
    [null, {}, { ...profile(), version: 0 }, { ...profile(), population: -1 }].forEach((p, index) => {
        it(`rejects invalid profile ${index}`, async () => { await failure(() => run(p, [row()]), 'INVALID_PROFILE'); });
    });
    it('requires a focus area rather than silently scoring unrelated profile text', async () => {
        await failure(() => run({ ...profile(), focusAreas: [] }, [row()]), 'PROFILE_FOCUS_REQUIRED');
    });
    [undefined, '2026-02-29', '2026-10-23T12:00:00Z'].forEach((asOfDate) => {
        it(`rejects invalid screening date ${String(asOfDate)}`, async () => {
            await failure(() => run(profile(), [row()], { asOfDate }), 'INVALID_DATE');
        });
    });
    [null, [null], [row(-1)], [row('1')], Array.from({ length: 251 }, (_, index) => row(index))].forEach((rows, index) => {
        it(`rejects invalid candidate set ${index}`, async () => { await failure(() => run(profile(), rows), 'INVALID_CANDIDATES'); });
    });
    it('rejects duplicate IDs instead of silently choosing one source revision', async () => {
        await failure(() => run(profile(), [row(1), row(1, { revision_id: 6 })]), 'DUPLICATE_CANDIDATE');
    });
    it('bounds source text size', async () => {
        await failure(() => run(profile(), [row(1, { description: 'a'.repeat(32001) })]), 'INPUT_TOO_LARGE');
        await failure(() => run(profile(), [row(1, { title: 'a'.repeat(32000), description: 'b'.repeat(32000) })]), 'INPUT_TOO_LARGE');
    });
    it('rejects a changed or unpinned model manifest', async () => {
        const embedder = fakeEmbedder(); embedder.manifest.revision = 'main';
        await failure(() => run(profile(), [row()], { embedder }), 'MODEL_RUNTIME_MISMATCH');
        delete embedder.manifest;
        await failure(() => run(profile(), [row()], { embedder }), 'MODEL_RUNTIME_MISMATCH');
    });
    [[], [{ vector: vector(1), tokenCount: 8, truncated: false }], null].forEach((output, index) => {
        it(`rejects wrong embedding output count ${index}`, async () => {
            const embedder = fakeEmbedder(); embedder.embed = async () => output;
            await failure(() => run(profile(), [row()], { embedder }), 'INVALID_EMBEDDING');
        });
    });
    [vector(0), [1, 2], vector(NaN), vector(Infinity)].forEach((bad, index) => {
        it(`rejects invalid model vector ${index}`, async () => {
            const embedder = fakeEmbedder();
            embedder.embed = async () => [0, 1].map(() => ({ vector: bad, tokenCount: 8, truncated: false }));
            await failure(() => run(profile(), [row()], { embedder }), 'INVALID_EMBEDDING');
        });
    });
    it('rejects invalid token/truncation metadata', async () => {
        const embedder = fakeEmbedder();
        embedder.embed = async () => [0, 1].map(() => ({ vector: vector(1), tokenCount: 257, truncated: false }));
        await failure(() => run(profile(), [row()], { embedder }), 'INVALID_EMBEDDING');
    });
});

describe('C-09 cosine and text normalization', () => {
    it('clamps to [0,1], normalizes vector lengths, and rounds to six decimals', () => {
        expect(cosineScore(vector(1), vector(8))).to.equal(1);
        expect(cosineScore(vector(1), vector(-1))).to.equal(0);
        expect(cosineScore(vector(1), vector(0, 1))).to.equal(0);
        expect(cosineScore(vector(1), vector(1, 1))).to.equal(0.707107);
    });
    it('normalizes text without rendering HTML or interpreting it as instructions', () => {
        expect(plainText(' <p>Stormwater&nbsp; &amp; flood prevention</p> ')).to.equal('Stormwater & flood prevention');
        expect(plainText(null)).to.equal('');
    });
});
