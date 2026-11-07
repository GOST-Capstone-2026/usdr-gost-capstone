// Explicit opt-in isolated PostgreSQL suite. Never use the application's fixture/reseed setup.
const { expect } = require('chai');
const express = require('express');
const cookieParser = require('cookie-parser');
const { sign } = require('cookie-signature');
const supertest = require('supertest');
const makeKnex = require('knex');
const { types } = require('pg');
const { builtins } = require('pg-types');
const { createMatchRunRepository } = require('../../src/db/grantMatchRuns');
const { createMatchRunner } = require('../../src/lib/matchRuns');
const { createMatchRunsRouter } = require('../../src/routes/complianceMatches');
const { createLocalEmbedder } = require('../../src/lib/localSemanticEmbedding');
const profileMigration = require('../../migrations/20260918000000_create_organization_profiles');
const matchMigration = require('../../migrations/20261025000000_create_grant_match_runs');
const fixture = require('../../demo/semantic-ranking-fixtures.json');
const manifest = require('../../src/lib/semanticModelManifest.json');

const databaseUrl = process.env.G32_MATCH_TEST_DATABASE_URL;
if (databaseUrl) {
    const parsed = new URL(databaseUrl);
    if (!['localhost', '127.0.0.1'].includes(parsed.hostname)
        || !/^\/g32_c11_verify_[a-z0-9_]+$/.test(parsed.pathname)) throw new Error('Refusing a non-isolated match test database.');
}
const suite = databaseUrl ? describe : describe.skip;

suite('C-11 signed-cookie API and persistence on isolated PostgreSQL', function () {
    this.timeout(60000);
    let knex;
    let api;
    let repository;
    let enabled = true;
    let modelFactory;
    const previousDateParser = types.getTypeParser(builtins.DATE);
    const cookie = (id) => `userId=s:${sign(String(id), 'isolated-c11-cookie-secret')}`;
    const path = (org = 0, suffix = '') => `/api/organizations/${org}/compliance/match-runs${suffix}`;
    const body = () => ({
        profileId: 1, profileVersion: 1, limit: 6, candidateGrantIds: fixture.grants.map((row) => row.grant_id),
    });
    const stubModel = async () => ({
        manifest,
        dispose: async () => {},
        embed: async (texts) => texts.map(() => ({ vector: [1, ...Array(383).fill(0)], tokenCount: 2, truncated: false })),
    });
    const totalRuns = async () => Number((await knex('grant_match_runs').count('* as total').first()).total);

    before(async () => {
        // Match production's date-only parser without importing its production connection pool.
        types.setTypeParser(builtins.DATE, (value) => value);
        knex = makeKnex({ client: 'pg', connection: databaseUrl, pool: { min: 0, max: 4 } });
        const current = await knex.raw('SELECT current_database() AS name');
        expect(current.rows[0].name).to.match(/^g32_c11_verify_[a-z0-9_]+$/);
        if (await knex.schema.hasTable('agencies')) throw new Error('Tests require a fresh isolated database; existing tables are preserved.');
        await knex.schema.createTable('tenants', (table) => { table.integer('id').primary(); });
        await knex.schema.createTable('agencies', (table) => { table.integer('id').primary(); table.integer('tenant_id').notNullable(); });
        await knex.schema.createTable('users', (table) => {
            table.integer('id').primary(); table.integer('agency_id'); table.integer('tenant_id'); table.string('role_name');
        });
        await knex.schema.createTable('grants', (table) => {
            table.text('grant_id').primary(); table.text('revision_id'); table.text('title'); table.text('description');
            table.text('opportunity_status'); table.date('close_date'); table.text('close_date_explanation');
            table.text('eligibility_codes'); table.text('cost_sharing'); table.jsonb('raw_body_json');
        });
        await knex('tenants').insert([{ id: 1 }, { id: 2 }]);
        await knex('agencies').insert([{ id: 0, tenant_id: 1 }, { id: 2, tenant_id: 2 }, { id: 3, tenant_id: 1 }]);
        await knex('users').insert([
            {
                id: 1, agency_id: 0, tenant_id: 1, role_name: 'staff',
            },
            {
                id: 2, agency_id: 0, tenant_id: 1, role_name: 'admin',
            },
            {
                id: 3, agency_id: 2, tenant_id: 2, role_name: 'admin',
            },
            {
                id: 4, agency_id: 0, tenant_id: 1, role_name: 'viewer',
            },
        ]);
        await profileMigration.up(knex);
        await matchMigration.up(knex);
        const profileValues = (id, organization, tenant) => ({
            id,
            organization_id: organization,
            tenant_id: tenant,
            version: 1,
            jurisdiction: JSON.stringify(fixture.profile.jurisdiction),
            population: fixture.profile.population,
            focus_areas: JSON.stringify(fixture.profile.focusAreas),
            staffing_capacity: JSON.stringify(fixture.profile.staffingCapacity),
            matching_funds: JSON.stringify(fixture.profile.matchingFunds),
            created_by: 1,
            updated_by: 1,
        });
        await knex('organization_profiles').insert([profileValues(1, 0, 1), profileValues(2, 2, 2), profileValues(3, 3, 1)]);
        await knex('grants').insert(fixture.grants.map((row) => ({ ...row, grant_id: String(row.grant_id), revision_id: '1' })));
        repository = createMatchRunRepository(knex);
        const app = express();
        app.use(cookieParser('isolated-c11-cookie-secret'));
        app.use(express.json());
        app.use('/api/organizations/:organizationId/compliance/match-runs', createMatchRunsRouter({
            getUser: (userId) => knex('users').where({ id: userId }).first(),
            repository,
            runMatching: createMatchRunner({ repository, createEmbedder: () => modelFactory(), now: () => new Date('2026-10-26T02:00:00Z') }),
            enabled: () => enabled,
        }));
        api = supertest(app);
    });
    beforeEach(async () => {
        enabled = true;
        modelFactory = stubModel;
        await knex('organization_profiles').where({ id: 1 }).update({ version: 1 });
    });
    after(async () => {
        types.setTypeParser(builtins.DATE, previousDateParser);
        if (knex) await knex.destroy();
    });

    it('rejects missing, unsigned, unknown and unsupported-role sessions', async () => {
        await Promise.all([null, 'userId=1', cookie(999), cookie(4)].map(async (value) => {
            const req = api.get(path(0, '/1'));
            if (value) req.set('Cookie', value);
            const response = await req;
            expect(response.status).to.equal(403);
            expect(response.body.error.code).to.equal('FORBIDDEN');
        }));
    });
    it('rejects cross-organization staff and cross-tenant admin access before starting work', async () => {
        const before = await totalRuns();
        expect((await api.post(path(3)).set('Cookie', cookie(1)).send(body())).status).to.equal(403);
        expect((await api.post(path(0)).set('Cookie', cookie(3)).send(body())).status).to.equal(404);
        expect(await totalRuns()).to.equal(before);
    });
    it('returns controlled feature-disabled and invalid-ID errors', async () => {
        enabled = false;
        const disabled = await api.post(path()).set('Cookie', cookie(1)).send(body());
        expect(disabled.status).to.equal(404);
        expect(disabled.body.error.code).to.equal('FEATURE_DISABLED');
        enabled = true;
        expect((await api.get(path('abc', '/1')).set('Cookie', cookie(2))).status).to.equal(400);
        expect((await api.get(path(0, '/0')).set('Cookie', cookie(1))).status).to.equal(400);
    });
    it('creates a durable run from real SQL text IDs and reopens the exact saved result', async () => {
        const created = await api.post(path()).set('Cookie', cookie(1)).send(body());
        expect(created.status).to.equal(201);
        expect(created.headers['cache-control']).to.equal('no-store');
        const { run } = created.body;
        expect(run).to.include({
            organizationId: 0, profileId: 1, profileVersion: 1, createdBy: 1, status: 'reviewRequired', reviewRequired: true,
        });
        expect(run.result).to.include({
            candidateCount: 6, rankedCount: 3, blockedCount: 2, screenedOn: '2026-10-25',
        });
        expect(run).not.to.have.property('input_snapshot');
        expect(run).not.to.have.property('inputs');
        expect(run.result.results.filter((row) => row.disposition === 'blocked').every((row) => row.rank === null && row.score === null)).to.equal(true);
        expect(run.result.results.every((row) => row.explanationDetails.verificationStatus === 'unverified')).to.equal(true);
        expect(run.result.results.find((row) => row.grantId === 930001).disposition).to.equal('eligible');
        const fetched = await api.get(created.body.links.self).set('Cookie', cookie(1));
        expect(fetched.status).to.equal(200);
        expect(fetched.body.run).to.deep.equal(run);
        const stored = await knex('grant_match_runs').where({ id: run.id }).first();
        expect(stored.input_snapshot.rows[0].grant_id).to.be.a('string');
        expect(stored.tenant_id).to.equal(1);
        expect((await api.get(path(2, `/${run.id}`)).set('Cookie', cookie(3))).status).to.equal(404);
        expect((await api.get(path(3, `/${run.id}`)).set('Cookie', cookie(2))).status).to.equal(404);
    });
    it('allows an admin to match a different organization only within the same tenant', async () => {
        const response = await api.post(path(3)).set('Cookie', cookie(2)).send({ ...body(), profileId: 3 });
        expect(response.status).to.equal(201);
        expect(response.body.run).to.include({ organizationId: 3, profileId: 3, createdBy: 2 });
        expect(response.body.run.result.organizationId).to.equal(3);
    });
    it('rejects stale, foreign and missing profiles without creating records', async () => {
        const before = await totalRuns();
        await [[1, 2, 409], [2, 1, 404], [999, 1, 404]].reduce((previous, [profileId, profileVersion, status]) => previous.then(async () => {
            expect((await api.post(path()).set('Cookie', cookie(1)).send({ ...body(), profileId, profileVersion })).status).to.equal(status);
        }), Promise.resolve());
        expect(await totalRuns()).to.equal(before);
    });
    it('rejects forged ownership, raw input rows, invalid limits, duplicate and unavailable candidates', async () => {
        const before = await totalRuns();
        await [{ tenantId: 2 }, { profile: {} }, { rows: [] }, { limit: 51 }, { candidateGrantIds: [1, 1] }].reduce((previous, extra) => previous.then(async () => {
            const response = await api.post(path()).set('Cookie', cookie(1)).send({ ...body(), ...extra });
            expect(response.status).to.equal(400);
            expect(response.body.error.code).to.equal('VALIDATION_ERROR');
        }), Promise.resolve());
        expect((await api.post(path()).set('Cookie', cookie(1)).send({ ...body(), candidateGrantIds: [999999] })).status).to.equal(404);
        expect(await totalRuns()).to.equal(before);
    });
    it('labels the bounded default pool instead of pretending to search all grants', async () => {
        const response = await api.post(path()).set('Cookie', cookie(1)).send({ profileId: 1, profileVersion: 1, limit: 2 });
        expect(response.status).to.equal(201);
        expect(response.body.run.result.candidateSelection).to.deep.equal({
            strategy: 'stored-current-id-ascending', limit: 2, totalAvailable: 5, selectedCount: 2, limited: true,
        });
    });
    it('rechecks the profile version after inference and refuses to save an obsolete run', async () => {
        const before = await totalRuns();
        modelFactory = async () => {
            await knex('organization_profiles').where({ id: 1 }).update({ version: 2 });
            return stubModel();
        };
        const response = await api.post(path()).set('Cookie', cookie(1)).send(body());
        expect(response.status).to.equal(409);
        expect(response.body.error.code).to.equal('VERSION_CONFLICT');
        expect(await totalRuns()).to.equal(before);
    });
    it('does not leak model details or invent a successful record on model failure', async () => {
        const before = await totalRuns();
        modelFactory = async () => { throw Object.assign(new Error('private /path/token secret'), { code: 'MODEL_NOT_CACHED' }); };
        const response = await api.post(path()).set('Cookie', cookie(1)).send(body());
        expect(response.status).to.equal(503);
        expect(response.body.error).to.include({ code: 'MODEL_NOT_CACHED', retryable: false });
        expect(JSON.stringify(response.body)).not.to.contain('secret');
        expect(await totalRuns()).to.equal(before);
    });
    it('maps an unexpected error or prototype-like code to a controlled response', async () => {
        modelFactory = async () => { throw Object.assign(new Error('private provider path/token'), { code: 'constructor' }); };
        const response = await api.post(path()).set('Cookie', cookie(1)).send(body());
        expect(response.status).to.equal(500);
        expect(response.body.error.code).to.equal('INTERNAL_ERROR');
        expect(response.body.error.requestId).to.be.a('string');
        expect(JSON.stringify(response.body)).not.to.contain('token');
    });
    it('returns a profile-focus error without creating a record', async () => {
        const before = await totalRuns();
        await knex('organization_profiles').where({ id: 1 }).update({ focus_areas: '[]' });
        try {
            const response = await api.post(path()).set('Cookie', cookie(1)).send(body());
            expect(response.status).to.equal(422);
            expect(response.body.error.code).to.equal('PROFILE_FOCUS_REQUIRED');
            expect(await totalRuns()).to.equal(before);
        } finally {
            await knex('organization_profiles').where({ id: 1 }).update({ focus_areas: JSON.stringify(fixture.profile.focusAreas) });
        }
    });
    it('creates a new run per retry and preserves the exact earlier snapshot after source updates', async () => {
        const first = await api.post(path()).set('Cookie', cookie(1)).send(body());
        const second = await api.post(path()).set('Cookie', cookie(1)).send(body());
        expect(first.body.run.id).not.to.equal(second.body.run.id);
        expect(first.body.run.result.inputHash).to.equal(second.body.run.result.inputHash);
        await knex('grants').where({ grant_id: '930001' }).update({ title: 'Changed after matching', revision_id: '2' });
        const fetched = await api.get(first.body.links.self).set('Cookie', cookie(1));
        expect(fetched.body.run).to.deep.equal(first.body.run);
    });
    const realModelTest = process.env.G32_MATCH_TEST_MODEL_CACHE ? it : it.skip;
    realModelTest('runs and reopens the real checksummed cached model through the signed-cookie API', async () => {
        modelFactory = () => createLocalEmbedder({ cacheDir: process.env.G32_MATCH_TEST_MODEL_CACHE });
        const response = await api.post(path()).set('Cookie', cookie(1)).send(body());
        expect(response.status).to.equal(201);
        expect(response.body.run.result.model).to.contain(manifest.revision);
        expect(response.body.run.result.blockedCount).to.equal(2);
        const fetched = await api.get(response.body.links.self).set('Cookie', cookie(1));
        expect(fetched.body.run.result).to.deep.equal(response.body.run.result);
    });
});
