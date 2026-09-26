const { expect } = require('chai');
const { getSessionCookie, makeTestServer } = require('./utils');

describe('`/api/organizations/:organizationId/compliance/deadlines` endpoint', () => {
    const usdrAgencyId = 0;
    const otherTenantAgencyId = 384;

    const fetchOptions = {
        admin: {
            headers: {
                'Content-Type': 'application/json',
                cookie: undefined,
            },
        },
    };

    let testServer;
    let fetchApi;

    before(async function beforeHook() {
        this.timeout(9000);
        fetchOptions.admin.headers.cookie = await getSessionCookie('alex@usdigitalresponse.org');

        testServer = await makeTestServer();
        fetchApi = testServer.fetchApi;
    });

    after(() => {
        testServer.stop();
    });

    context('GET /compliance/deadlines', () => {
        it('returns only verified checklist items that have a due date', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin);
            expect(response.status).to.equal(200);

            const json = await response.json();
            expect(json.data.length).to.equal(4);
            json.data.forEach((item) => {
                expect(item.verificationStatus).to.equal('verified');
                expect(item.dueDate).to.not.equal(null);
            });
        });

        it('computes overdue for a past-due, incomplete item', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin);
            const json = await response.json();
            const item = json.data.find((i) => i.title === 'Submit quarterly financial status report');
            expect(item.status).to.equal('overdue');
        });

        it('computes upcoming for a far-future, incomplete item', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin);
            const json = await response.json();
            const item = json.data.find((i) => i.title === 'Complete annual performance report');
            expect(item.status).to.equal('upcoming');
        });

        it('marks a completed item finished before its due date as on time', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin);
            const json = await response.json();
            const item = json.data.find((i) => i.title === 'Submit annual audit certification');
            expect(item.status).to.equal('completed');
            expect(new Date(item.completedAt) < new Date(item.dueDate)).to.equal(true);
        });

        it('marks a completed item finished after its due date as late', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin);
            const json = await response.json();
            const item = json.data.find((i) => i.title === 'Submit close-out financial report');
            expect(item.status).to.equal('completed');
            expect(new Date(item.completedAt) > new Date(item.dueDate)).to.equal(true);
        });

        it('rejects a request for an organization outside the user\'s tenant', async () => {
            const response = await fetchApi('/compliance/deadlines', otherTenantAgencyId, fetchOptions.admin);
            expect(response.status).to.equal(403);
        });

        it('rejects an invalid status filter', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin, { status: 'banana' });
            expect(response.status).to.equal(400);
            const json = await response.json();
            expect(json.error.code).to.equal('VALIDATION_ERROR');
        });

        it('filters results by status when requested', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin, { status: 'overdue' });
            expect(response.status).to.equal(200);
            const json = await response.json();
            expect(json.data.length > 0).to.equal(true);
            expect(json.data.every((item) => item.status === 'overdue')).to.equal(true);
        });

        it('rejects an unauthenticated request', async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, { headers: { 'Content-Type': 'application/json' } });
            expect(response.status).to.equal(403);
        });
    });
});
