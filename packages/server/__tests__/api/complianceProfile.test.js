const { expect } = require('chai');
const { getSessionCookie, makeTestServer, knex } = require('./utils');

const PROFILE = {
    expectedVersion: 0,
    jurisdiction: {
        type: 'city', name: 'Example City', stateCode: 'FL', countyName: 'Example County',
    },
    population: 42000,
    focusAreas: ['stormwater', 'public safety'],
    staffingCapacity: { level: 'limited', fullTimeEquivalent: 1.5, notes: 'Part-time support' },
    matchingFunds: { available: true, maximumAmountCents: 25000000, notes: 'Pending approval' },
};

describe('organization compliance profile API', () => {
    let server;
    let staffCookie;
    let adminCookie;
    let oldMaster;
    let oldProfile;

    before(async () => {
        oldMaster = process.env.ENABLE_GRANT_COMPLIANCE;
        oldProfile = process.env.ENABLE_ORGANIZATION_PROFILES;
        process.env.ENABLE_GRANT_COMPLIANCE = 'true';
        process.env.ENABLE_ORGANIZATION_PROFILES = 'true';
        staffCookie = await getSessionCookie('user2@nv.example.com');
        adminCookie = await getSessionCookie('mindy@usdigitalresponse.org');
        server = await makeTestServer();
    });

    beforeEach(async () => {
        await knex('organization_profiles').where('organization_id', 384).del();
    });

    after(async () => {
        await knex('organization_profiles').where('organization_id', 384).del();
        server.stop();
        if (oldMaster === undefined) delete process.env.ENABLE_GRANT_COMPLIANCE;
        else process.env.ENABLE_GRANT_COMPLIANCE = oldMaster;
        if (oldProfile === undefined) delete process.env.ENABLE_ORGANIZATION_PROFILES;
        else process.env.ENABLE_ORGANIZATION_PROFILES = oldProfile;
    });

    const url = '/api/organizations/384/compliance/profile';

    it('creates, reads, and updates an organization-owned profile with versions', async () => {
        const created = await server.put(url).set('Cookie', staffCookie).send(PROFILE);
        expect(created.status).to.equal(201);
        expect(created.body.profile).to.include({ organizationId: 384, version: 1, population: 42000 });
        expect(created.body.profile).to.have.property('createdBy');
        expect(created.body.profile).to.have.property('updatedAt');

        const fetched = await server.get(url).set('Cookie', staffCookie);
        expect(fetched.status).to.equal(200);
        expect(fetched.body.profile.focusAreas).to.deep.equal(PROFILE.focusAreas);

        const duplicateCreate = await server.put(url).set('Cookie', staffCookie).send(PROFILE);
        expect(duplicateCreate.status).to.equal(409);
        expect(duplicateCreate.body.error.code).to.equal('VERSION_CONFLICT');

        const updated = await server.put(url).set('Cookie', staffCookie)
            .send({ ...PROFILE, expectedVersion: 1, population: 43000 });
        expect(updated.status).to.equal(200);
        expect(updated.body.profile).to.include({ version: 2, population: 43000 });

        const stale = await server.put(url).set('Cookie', staffCookie)
            .send({ ...PROFILE, expectedVersion: 1, population: 44000 });
        expect(stale.status).to.equal(409);
        expect(stale.body.error.code).to.equal('VERSION_CONFLICT');
        const unchanged = await server.get(url).set('Cookie', staffCookie);
        expect(unchanged.body.profile.population).to.equal(43000);
    });

    it('rejects invalid fields without writing a profile', async () => {
        const response = await server.put(url).set('Cookie', staffCookie)
            .send({ ...PROFILE, population: -1, tenantId: 1 });
        expect(response.status).to.equal(400);
        expect(response.body.error.code).to.equal('VALIDATION_ERROR');
        expect(response.body.error.details.map((detail) => detail.field)).to.include('population');
        expect(response.body.error.details.map((detail) => detail.field)).to.include('tenantId');
        const count = await knex('organization_profiles').where('organization_id', 384).count('id as count').first();
        expect(Number(count.count)).to.equal(0);
    });

    it('returns a controlled error for malformed JSON', async () => {
        const response = await server.put(url).set('Cookie', staffCookie)
            .set('Content-Type', 'application/json').send('{');
        expect(response.status).to.equal(400);
        expect(response.body.error.code).to.equal('VALIDATION_ERROR');
        expect(response.body.error).to.have.property('requestId');
    });

    it('rejects an unauthenticated request and a cross-tenant admin', async () => {
        const anonymous = await server.get(url);
        expect(anonymous.status).to.equal(403);
        expect(anonymous.body.error.code).to.equal('FORBIDDEN');

        const crossTenant = await server.get(url).set('Cookie', adminCookie);
        expect(crossTenant.status).to.equal(404);
        expect(crossTenant.body.error.code).to.equal('NOT_FOUND');

        const crossAgency = await server.get('/api/organizations/18/compliance/profile')
            .set('Cookie', staffCookie);
        expect(crossAgency.status).to.equal(403);
        expect(crossAgency.body.error.code).to.equal('FORBIDDEN');
    });

    it('requires both server feature flags', async () => {
        process.env.ENABLE_ORGANIZATION_PROFILES = 'false';
        const response = await server.get(url).set('Cookie', staffCookie);
        expect(response.status).to.equal(404);
        expect(response.body.error.code).to.equal('FEATURE_DISABLED');
        process.env.ENABLE_ORGANIZATION_PROFILES = 'true';
        process.env.ENABLE_GRANT_COMPLIANCE = 'false';
        const masterOff = await server.get(url).set('Cookie', staffCookie);
        expect(masterOff.status).to.equal(404);
        expect(masterOff.body.error.code).to.equal('FEATURE_DISABLED');
        process.env.ENABLE_GRANT_COMPLIANCE = 'true';
    });
});
