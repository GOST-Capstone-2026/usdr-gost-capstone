// A-13: making sure one organization can't see or change another organization's compliance data.
// every compliance route gets tried by every kind of user, checking that:
//   1. members can still reach their own data (so blocking everyone can't fake a pass)
//   2. everyone else is blocked, and the error doesn't leak the other org's data
//   3. blocked writes don't change anything
// org A = USDR (agency 0, tenant 1), its sibling TSDR (agency 400, tenant 1), org B = Nevada (agency 384, tenant 2).
// see docs/g32-a13-organization-isolation.md for the plain-english version.
const crypto = require('crypto');
const { expect } = require('chai');
const { sign: signCookie } = require('cookie-signature');
const { getSessionCookie, makeTestServer, knex } = require('./utils');
const { listAiAuditRecords } = require('../../src/lib/ai-audit');

const ORG_A = 0;
const ORG_A_SIBLING = 400;
const ORG_B = 384;
const GRANT_ID = '335255';

// marker strings planted in org A's rows; none may show up in a response to anyone outside org A
const SECRET = {
    filename: 'a13-org-a-secret.pdf',
    focusArea: 'a13 org a secret focus',
    deadline: 'a13 org a secret deadline',
    briefPurpose: 'a13 org a secret purpose',
};

const USERS = {
    aStaff: 'staff@example.com', // staff, agency 0, tenant 1
    aAdmin: 'admin@example.com', // admin, agency 0, tenant 1
    aSiblingStaff: 'mindy+testsub@usdigitalresponse.org', // staff, agency 400, tenant 1
    bStaff: 'user2@nv.example.com', // staff, agency 384, tenant 2
    bAdmin: 'admin1@nv.example.com', // admin, agency 384, tenant 2
};

function profileRow(organizationId, tenantId, userId, focusArea) {
    return {
        organization_id: organizationId,
        tenant_id: tenantId,
        version: 1,
        jurisdiction: JSON.stringify({ type: 'city', name: 'A13 City', stateCode: 'FL' }),
        population: 1000,
        focus_areas: JSON.stringify([focusArea]),
        staffing_capacity: JSON.stringify({ level: 'limited' }),
        matching_funds: JSON.stringify({ available: false }),
        created_by: userId,
        updated_by: userId,
    };
}

function briefRow(documentId, runId, purpose) {
    const empty = JSON.stringify({ value: null, sources: [] });
    return {
        document_id: documentId,
        run_id: runId,
        purpose: JSON.stringify({ value: purpose, sources: [] }),
        eligibility: empty,
        funding_range: empty,
        key_dates: JSON.stringify([]),
        cost_share: empty,
        key_requirements: JSON.stringify([]),
        not_found_fields: JSON.stringify([]),
    };
}

// planting one document, run, brief, deadline and profile for an org, straight into the db (no s3 needed)
async function seedOrg(agencyId, tenantId, userId, label) {
    const [document] = await knex('grant_documents').insert({
        agency_id: agencyId,
        grant_id: GRANT_ID,
        uploaded_by: userId,
        filename: label === 'A' ? SECRET.filename : `a13-org-${label}.pdf`,
        mime_type: 'application/pdf',
        size_bytes: 1234,
        sha256: crypto.randomBytes(32).toString('hex'),
        storage_bucket: 'grant-documents',
        storage_key: `a13/${label}.pdf`,
    }).returning('*');
    const [run] = await knex('analysis_runs').insert({ document_id: document.id, status: 'completed' }).returning('*');
    await knex('grant_briefs').insert(briefRow(document.id, run.id, label === 'A' ? SECRET.briefPurpose : `org ${label} purpose`));
    const [deadline] = await knex('checklist_items_placeholder').insert({
        agency_id: agencyId,
        category: 'reporting',
        description: label === 'A' ? SECRET.deadline : `a13 org ${label} deadline`,
        due_date: '2026-12-15',
        verification_status: 'verified',
    }).returning('*');
    await knex('organization_profiles').where('organization_id', agencyId).del();
    await knex('organization_profiles').insert(profileRow(agencyId, tenantId, userId, label === 'A' ? SECRET.focusArea : `org ${label} focus`));
    return { documentId: document.id, runId: run.id, deadlineId: deadline.id };
}

// every org-scoped compliance route, built against a url org and a set of resource ids
function routes(urlOrg, ids) {
    const base = `/api/organizations/${urlOrg}/compliance`;
    return [
        { name: 'GET profile', method: 'get', url: `${base}/profile` },
        {
            name: 'PUT profile',
            method: 'put',
            url: `${base}/profile`,
            body: {
                expectedVersion: 1,
                jurisdiction: { type: 'city', name: 'Hijacked', stateCode: 'NV' },
                population: 1,
                focusAreas: ['hijacked'],
                staffingCapacity: { level: 'limited' },
                matchingFunds: { available: true },
            },
        },
        {
            name: 'POST document upload', method: 'post', url: `${base}/documents`, field: ['grantId', GRANT_ID],
        },
        { name: 'GET document', method: 'get', url: `${base}/documents/${ids.documentId}` },
        { name: 'GET brief', method: 'get', url: `${base}/documents/${ids.documentId}/brief` },
        { name: 'POST analysis run', method: 'post', url: `${base}/documents/${ids.documentId}/analysis-runs` },
        { name: 'GET analysis run', method: 'get', url: `${base}/analysis-runs/${ids.runId}` },
        { name: 'GET deadlines', method: 'get', url: `${base}/deadlines` },
        {
            name: 'PATCH deadline',
            method: 'patch',
            url: `${base}/deadlines/${ids.deadlineId}`,
            body: { dueDate: '2030-01-01', completionStatus: 'completed' },
        },
    ];
}

describe('A-13 organization isolation and authorization', () => {
    let server;
    let cookies;
    let userIds;
    let orgA;
    let orgB;
    let siblingDeadlineId;
    let oldMaster;
    let oldProfile;

    async function send(route, cookie) {
        let request = server[route.method](route.url);
        if (cookie) request = request.set('Cookie', cookie);
        if (route.field) request = request.field(...route.field);
        if (route.body) request = request.send(route.body);
        return request;
    }

    function expectNoOrgASecrets(response) {
        const text = JSON.stringify(response.body) + (response.text || '');
        Object.values(SECRET).forEach((secret) => {
            expect(text, `response leaked "${secret}"`).to.not.include(secret);
        });
    }

    // snapshotting org A's rows so we can prove denied writes changed nothing
    async function snapshotOrgA() {
        return {
            deadline: await knex('checklist_items_placeholder').where('id', orgA.deadlineId).first(),
            profile: await knex('organization_profiles').where('organization_id', ORG_A).first(),
            runCount: (await knex('analysis_runs').where('document_id', orgA.documentId).count('* as n').first()).n,
            documentCount: (await knex('grant_documents').where('agency_id', ORG_A).count('* as n').first()).n,
        };
    }

    before(async function beforeHook() {
        this.timeout(15000);
        oldMaster = process.env.ENABLE_GRANT_COMPLIANCE;
        oldProfile = process.env.ENABLE_ORGANIZATION_PROFILES;
        process.env.ENABLE_GRANT_COMPLIANCE = 'true';
        process.env.ENABLE_ORGANIZATION_PROFILES = 'true';

        const rows = await knex('users').select('id', 'email').whereIn('email', Object.values(USERS));
        userIds = Object.fromEntries(Object.entries(USERS).map(([key, email]) => [key, rows.find((r) => r.email === email).id]));
        cookies = Object.fromEntries(await Promise.all(Object.entries(USERS).map(async ([key, email]) => [key, await getSessionCookie(email)])));

        orgA = await seedOrg(ORG_A, 1, userIds.aStaff, 'A');
        orgB = await seedOrg(ORG_B, 2, userIds.bStaff, 'B');
        const [sibling] = await knex('checklist_items_placeholder').insert({
            agency_id: ORG_A_SIBLING, category: 'reporting', description: 'a13 sibling deadline', due_date: '2026-12-20', verification_status: 'verified',
        }).returning('*');
        siblingDeadlineId = sibling.id;

        server = await makeTestServer();
    });

    after(async () => {
        await knex('checklist_items_placeholder').whereIn('id', [orgA.deadlineId, orgB.deadlineId, siblingDeadlineId]).del();
        await knex('grant_briefs').whereIn('document_id', [orgA.documentId, orgB.documentId]).del();
        await knex('analysis_runs').whereIn('document_id', [orgA.documentId, orgB.documentId]).del();
        await knex('grant_documents').whereIn('id', [orgA.documentId, orgB.documentId]).del();
        await knex('organization_profiles').whereIn('organization_id', [ORG_A, ORG_B]).del();
        await knex('ai_audit_records').where('task', 'a13-isolation').del();
        server.stop();
        if (oldMaster === undefined) delete process.env.ENABLE_GRANT_COMPLIANCE;
        else process.env.ENABLE_GRANT_COMPLIANCE = oldMaster;
        if (oldProfile === undefined) delete process.env.ENABLE_ORGANIZATION_PROFILES;
        else process.env.ENABLE_ORGANIZATION_PROFILES = oldProfile;
    });

    context('positive controls: org members reach their own data', () => {
        it('lets org A staff read its own document, brief, run, deadlines and profile', async () => {
            const base = `/api/organizations/${ORG_A}/compliance`;
            const doc = await server.get(`${base}/documents/${orgA.documentId}`).set('Cookie', cookies.aStaff);
            expect(doc.status).to.equal(200);
            expect(doc.body.document.filename).to.equal(SECRET.filename);

            const brief = await server.get(`${base}/documents/${orgA.documentId}/brief`).set('Cookie', cookies.aStaff);
            expect(brief.status).to.equal(200);
            expect(brief.body.brief.purpose.value).to.equal(SECRET.briefPurpose);

            const run = await server.get(`${base}/analysis-runs/${orgA.runId}`).set('Cookie', cookies.aStaff);
            expect(run.status).to.equal(200);
            expect(run.body.analysisRun.documentId).to.equal(orgA.documentId);

            const profile = await server.get(`${base}/profile`).set('Cookie', cookies.aStaff);
            expect(profile.status).to.equal(200);
            expect(profile.body.profile.focusAreas).to.deep.equal([SECRET.focusArea]);
        });

        it('shows org A staff only org A deadlines, never org B or the sibling agency', async () => {
            const response = await server.get(`/api/organizations/${ORG_A}/compliance/deadlines`).set('Cookie', cookies.aStaff);
            expect(response.status).to.equal(200);
            const ids = [...response.body.data.portfolio, ...response.body.data.reviewNeeded].map((d) => d.checklistItemId);
            expect(ids).to.include(orgA.deadlineId);
            expect(ids).to.not.include(orgB.deadlineId);
            expect(ids).to.not.include(siblingDeadlineId);
        });

        it('lets org B staff read its own document', async () => {
            const response = await server.get(`/api/organizations/${ORG_B}/compliance/documents/${orgB.documentId}`).set('Cookie', cookies.bStaff);
            expect(response.status).to.equal(200);
            expect(response.body.document.organizationId).to.equal(ORG_B);
        });

        it('lets an admin open another agency in the same tenant, scoped to that agency only', async () => {
            // gost rule: admins may act for any agency in their own tenant
            const response = await server.get(`/api/organizations/${ORG_A_SIBLING}/compliance/deadlines`).set('Cookie', cookies.aAdmin);
            expect(response.status).to.equal(200);
            const ids = [...response.body.data.portfolio, ...response.body.data.reviewNeeded].map((d) => d.checklistItemId);
            expect(ids).to.include(siblingDeadlineId);
            expect(ids).to.not.include(orgA.deadlineId);
        });
    });

    context('authentication: callers with no valid session are turned away', () => {
        const callers = {
            'no cookie': () => null,
            'unsigned cookie': () => `userId=${userIds.aStaff}`,
            'cookie signed with the wrong secret': () => `userId=s:${signCookie(String(userIds.aStaff), 'not-the-secret')}`,
            'signed cookie for a user that does not exist': () => getSessionCookie(987654),
        };

        Object.entries(callers).forEach(([caller, makeCookie]) => {
            it(`rejects every compliance route with ${caller}`, async () => {
                const before = await snapshotOrgA();
                const cookie = await makeCookie();
                // eslint-disable-next-line no-restricted-syntax
                for (const route of routes(ORG_A, orgA)) {
                    // eslint-disable-next-line no-await-in-loop
                    const response = await send(route, cookie);
                    expect(response.status, `${route.name}`).to.equal(403);
                    expectNoOrgASecrets(response);
                }
                expect(await snapshotOrgA()).to.deep.equal(before);
            });
        });
    });

    context('cross-organization: outsiders using org A\'s url are turned away', () => {
        const outsiders = {
            'org B staff (other tenant)': 'bStaff',
            'org B admin (other tenant)': 'bAdmin',
            'sibling-agency staff (same tenant)': 'aSiblingStaff',
        };

        Object.entries(outsiders).forEach(([who, key]) => {
            it(`rejects ${who} on every org A route and changes nothing`, async () => {
                const before = await snapshotOrgA();
                // eslint-disable-next-line no-restricted-syntax
                for (const route of routes(ORG_A, orgA)) {
                    // eslint-disable-next-line no-await-in-loop
                    const response = await send(route, cookies[key]);
                    // the profile router hides other-tenant orgs as 404; everything else answers 403
                    expect(response.status, `${route.name}`).to.be.oneOf([403, 404]);
                    expectNoOrgASecrets(response);
                }
                expect(await snapshotOrgA()).to.deep.equal(before);
            });
        });

        it('does not let an admin reach an organization in another tenant', async () => {
            const response = await server.get(`/api/organizations/${ORG_B}/compliance/deadlines`).set('Cookie', cookies.aAdmin);
            expect(response.status).to.equal(403);
            const profile = await server.get(`/api/organizations/${ORG_B}/compliance/profile`).set('Cookie', cookies.aAdmin);
            expect(profile.status).to.equal(404);
        });
    });

    context('id guessing: outsiders using their own url with org A\'s ids get nothing', () => {
        const guessers = {
            'org B staff': ['bStaff', ORG_B],
            'org B admin': ['bAdmin', ORG_B],
            'sibling-agency staff in the same tenant': ['aSiblingStaff', ORG_A_SIBLING],
        };

        Object.entries(guessers).forEach(([who, [key, ownOrg]]) => {
            it(`returns 404 to ${who} for org A's document, brief, run and deadline, and changes nothing`, async () => {
                const before = await snapshotOrgA();
                const guessable = routes(ownOrg, orgA).filter((r) => /document$|brief|analysis|PATCH/.test(r.name) && r.name !== 'POST document upload');
                expect(guessable).to.have.length(5);
                // eslint-disable-next-line no-restricted-syntax
                for (const route of guessable) {
                    // eslint-disable-next-line no-await-in-loop
                    const response = await send(route, cookies[key]);
                    expect(response.status, `${route.name}`).to.equal(404);
                    expectNoOrgASecrets(response);
                }
                expect(await snapshotOrgA()).to.deep.equal(before);
            });
        });
    });

    context('malformed organization ids', () => {
        it('rejects staff using a look-alike org id such as 00 or 0abc', async () => {
            const lookAlikes = ['00', '0abc', '-0', '0.0'];
            // eslint-disable-next-line no-restricted-syntax
            for (const org of lookAlikes) {
                // eslint-disable-next-line no-await-in-loop
                const response = await server.get(`/api/organizations/${org}/compliance/deadlines`).set('Cookie', cookies.bStaff);
                expect(response.status, org).to.equal(403);
            }
        });

        it('rejects a non-numeric org id on the profile route', async () => {
            const response = await server.get('/api/organizations/abc/compliance/profile').set('Cookie', cookies.aStaff);
            expect(response.status).to.equal(400);
            expect(response.body.error.code).to.equal('VALIDATION_ERROR');
        });

        it('falls back to the admin\'s own org for a non-numeric id, never to someone else\'s', async () => {
            // documenting existing gost behavior: getAdminAuthInfo ignores a NaN org id
            const response = await server.get('/api/organizations/abc/compliance/deadlines').set('Cookie', cookies.bAdmin);
            expect(response.status).to.equal(200);
            const ids = [...response.body.data.portfolio, ...response.body.data.reviewNeeded].map((d) => d.checklistItemId);
            expect(ids).to.include(orgB.deadlineId);
            expect(ids).to.not.include(orgA.deadlineId);
            expectNoOrgASecrets(response);
        });
    });

    context('ai audit records (A-10) stay separated by tenant', () => {
        before(async () => {
            const base = {
                request_id: crypto.randomUUID(), task: 'a13-isolation', provider: 'mock', model: 'mock', status: 'success', duration_ms: 1, prompt_sha256: 'x', prompt_chars: 1,
            };
            await knex('ai_audit_records').insert([
                { ...base, request_id: crypto.randomUUID(), tenant_id: 0 },
                { ...base, request_id: crypto.randomUUID(), tenant_id: 1 },
                { ...base, request_id: crypto.randomUUID(), tenant_id: 2 },
            ]);
        });

        [0, 1, 2].forEach((tenantId) => {
            it(`returns only tenant ${tenantId}'s records when filtering by tenant ${tenantId}`, async () => {
                const rows = (await listAiAuditRecords(knex, { tenantId, limit: 500 })).filter((r) => r.task === 'a13-isolation');
                expect(rows).to.have.length(1);
                expect(rows[0].tenant_id).to.equal(tenantId);
            });
        });
    });
});
