const { expect } = require('chai');
const sinon = require('sinon');
const {
    validateMatchRequest, screeningDate, createMatchRunner,
} = require('../../src/lib/matchRuns');
const { profileEnabled, matchingEnabled } = require('../../src/lib/complianceConfig');
const fixtures = require('../../demo/semantic-ranking-fixtures.json');
const manifest = require('../../src/lib/semanticModelManifest.json');

const request = () => ({ profileId: 1, profileVersion: 1, limit: 6 });
const access = { organizationId: 0, tenantId: 1, userId: 1 };
const embedder = () => ({
    manifest,
    dispose: sinon.stub().resolves(),
    embed: async (texts) => texts.map(() => ({ vector: [1, ...Array(383).fill(0)], tokenCount: 2, truncated: false })),
});

describe('C-11 saved match-run workflow (isolated, no database)', () => {
    it('copies, sorts and validates only IDs/version/limit, with a default bounded pool', () => {
        const body = { ...request(), candidateGrantIds: [3, 1] };
        expect(validateMatchRequest(body)).to.deep.equal({ ...request(), candidateGrantIds: [1, 3] });
        expect(body.candidateGrantIds).to.deep.equal([3, 1]);
        expect(validateMatchRequest({ profileId: 1, profileVersion: 1 }).limit).to.equal(25);
    });
    const bad = [null, [], {}, { ...request(), tenantId: 2 }, { ...request(), rows: [] },
        { ...request(), profile: fixtures.profile }, { ...request(), profileId: '1' }, { ...request(), profileId: 2147483648 },
        { ...request(), profileVersion: 0 }, { ...request(), profileVersion: true },
        ...[0, -1, 51, 1.5, '25', null].map((limit) => ({ ...request(), limit })),
        ...[[], [1, 1], ['1'], [true], [-1], [1.5], [Number.MAX_SAFE_INTEGER + 1]].map((candidateGrantIds) => ({ ...request(), candidateGrantIds })),
        { ...request(), limit: 1, candidateGrantIds: [1, 2] }];
    bad.forEach((body, index) => it(`rejects invalid or ownership-spoofing request ${index + 1}`, () => {
        expect(() => validateMatchRequest(body)).to.throw().with.property('code', 'VALIDATION_ERROR');
    }));
    it('derives the screening date in New York instead of the host timezone or browser date', () => {
        expect(screeningDate(new Date('2026-10-26T02:00:00Z'))).to.equal('2026-10-25');
        expect(screeningDate(new Date('2026-03-09T03:30:00Z'))).to.equal('2026-03-08');
    });
    it('requires all three server flags and defaults off', () => {
        const names = ['ENABLE_GRANT_COMPLIANCE', 'ENABLE_ORGANIZATION_PROFILES', 'ENABLE_GRANT_MATCHING'];
        const previous = names.map((name) => process.env[name]);
        try {
            names.forEach((name) => { delete process.env[name]; });
            expect(matchingEnabled()).to.equal(false);
            names.forEach((name) => { process.env[name] = 'true'; });
            expect(profileEnabled()).to.equal(true);
            expect(matchingEnabled()).to.equal(true);
            names.forEach((name) => {
                process.env[name] = 'false';
                expect(matchingEnabled()).to.equal(false);
                process.env[name] = 'true';
            });
        } finally {
            names.forEach((name, index) => {
                if (previous[index] === undefined) delete process.env[name];
                else process.env[name] = previous[index];
            });
        }
    });
    function setup(createEmbedder = async () => embedder()) {
        const repository = {
            loadInputs: sinon.stub().resolves({
                profile: JSON.parse(JSON.stringify(fixtures.profile)),
                rows: JSON.parse(JSON.stringify(fixtures.grants)),
                selection: {
                    limit: 6, selectedCount: 6, totalAvailable: 6, limited: false,
                },
            }),
            save: sinon.stub().callsFake(async (scope, body, run) => ({ id: 1, ...run })),
        };
        return { repository, run: createMatchRunner({ repository, createEmbedder, now: () => new Date('2026-10-26T02:00:00Z') }) };
    }
    it('uses the actual C-06/C-09/C-10 pipeline, preserves blockers, and saves actual inputs and unverified output', async () => {
        const model = embedder();
        const { run, repository } = setup(async () => model);
        const saved = await run(access, request());
        expect(saved.status).to.equal('reviewRequired');
        expect(saved.result).to.include({
            organizationId: 0, profileId: 1, profileVersion: 1, candidateCount: 6, blockedCount: 2, screenedOn: '2026-10-25',
        });
        expect(saved.result.results.filter((row) => row.disposition === 'blocked').every((row) => row.rank === null && row.score === null)).to.equal(true);
        expect(repository.save.firstCall.args[0]).to.deep.equal(access);
        expect(saved.inputs.profile).to.deep.equal(fixtures.profile);
        expect(model.dispose.calledOnce).to.equal(true);
    });
    it('rejects an empty saved focus before starting the model or saving a run', async () => {
        const factory = sinon.stub().resolves(embedder());
        const { run, repository } = setup(factory);
        repository.loadInputs.resolves({ profile: { ...fixtures.profile, focusAreas: [] }, rows: [], selection: {} });
        try { await run(access, request()); throw new Error('Expected profile rejection'); } catch (error) { expect(error.code).to.equal('PROFILE_FOCUS_REQUIRED'); }
        expect(factory.called).to.equal(false);
        expect(repository.save.called).to.equal(false);
    });
    it('never writes a successful run after model failure, disposes the model, and releases the busy guard', async () => {
        const model = embedder();
        model.embed = sinon.stub().rejects(Object.assign(new Error('private model message'), { code: 'MODEL_RUNTIME_MISMATCH' }));
        const { run, repository } = setup(async () => model);
        const checkFailure = async () => {
            try { await run(access, request()); throw new Error('Expected failure'); } catch (error) { expect(error.code).to.equal('MODEL_RUNTIME_MISMATCH'); }
        };
        await checkFailure();
        await checkFailure();
        expect(repository.save.called).to.equal(false);
        expect(model.dispose.callCount).to.equal(2);
    });
    it('rejects overlapping model work and does not create an extra run', async () => {
        let release;
        const { run, repository } = setup(() => new Promise((resolve) => { release = resolve; }));
        const first = run(access, request());
        await new Promise((resolve) => { setImmediate(resolve); });
        try { await run(access, request()); throw new Error('Expected busy rejection'); } catch (error) { expect(error.code).to.equal('MATCHING_BUSY'); }
        release(embedder());
        await first;
        expect(repository.save.calledOnce).to.equal(true);
    });
    it('propagates a concurrent profile-version conflict instead of returning an unsaved result', async () => {
        const model = embedder();
        const { run, repository } = setup(async () => model);
        repository.save.rejects(Object.assign(new Error('stale'), { code: 'VERSION_CONFLICT' }));
        try { await run(access, request()); throw new Error('Expected conflict'); } catch (error) { expect(error.code).to.equal('VERSION_CONFLICT'); }
        expect(model.dispose.calledOnce).to.equal(true);
    });
});
