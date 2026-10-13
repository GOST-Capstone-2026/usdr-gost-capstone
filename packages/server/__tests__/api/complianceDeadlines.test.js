const { expect } = require('chai');
const { getSessionCookie, makeTestServer, knex } = require('./utils');

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

    context('PATCH /compliance/deadlines/:checklistItemId', () => {
        const patchDeadline = (agencyId, checklistItemId, payload, options = fetchOptions.admin) => fetchApi(
            `/compliance/deadlines/${checklistItemId}`,
            agencyId,
            { ...options, method: 'PATCH', body: JSON.stringify(payload) },
        );

        const findIdByDescription = async (description) => {
            const row = await knex('checklist_items_placeholder').where({ description }).first();
            return row.id;
        };

        let anyChecklistItemId;

        before(async () => {
            const response = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin);
            const json = await response.json();
            anyChecklistItemId = json.data[0].checklistItemId;
        });

        it('corrects a verified item\'s due date and resets it to unverified', async () => {
            const id = await findIdByDescription('Complete annual performance report');

            const response = await patchDeadline(usdrAgencyId, id, { dueDate: '2031-06-01' });
            expect(response.status).to.equal(200);

            const { deadline } = await response.json();
            expect(deadline.dueDate).to.equal('2031-06-01');
            expect(deadline.verificationStatus).to.equal('unverified');
            expect(deadline.verifiedBy).to.equal(null);
            expect(deadline.verifiedAt).to.equal(null);
        });

        it('attaches a due date to an item that previously had none', async () => {
            const id = await findIdByDescription('Maintain records supporting ongoing grant obligations');

            const response = await patchDeadline(usdrAgencyId, id, { dueDate: '2031-01-15' });
            expect(response.status).to.equal(200);

            const { deadline } = await response.json();
            expect(deadline.dueDate).to.equal('2031-01-15');
        });

        it('marks an item complete and stamps completedAt', async () => {
            const id = await findIdByDescription('Submit updated subrecipient monitoring plan');

            const response = await patchDeadline(usdrAgencyId, id, { completionStatus: 'completed' });
            expect(response.status).to.equal(200);

            const { deadline } = await response.json();
            expect(deadline.completionStatus).to.equal('completed');
            expect(deadline.status).to.equal('completed');
            expect(deadline.completedAt).to.not.equal(null);
        });

        it('clears completedAt when an item moves away from completed', async () => {
            const id = await findIdByDescription('Submit updated subrecipient monitoring plan');

            const response = await patchDeadline(usdrAgencyId, id, { completionStatus: 'inProgress' });
            expect(response.status).to.equal(200);

            const { deadline } = await response.json();
            expect(deadline.completionStatus).to.equal('inProgress');
            expect(deadline.completedAt).to.equal(null);
        });

        it('rejects a null due date', async () => {
            const response = await patchDeadline(usdrAgencyId, anyChecklistItemId, { dueDate: null });
            expect(response.status).to.equal(400);
            const json = await response.json();
            expect(json.error.code).to.equal('VALIDATION_ERROR');
        });

        it('rejects a malformed due date', async () => {
            const response = await patchDeadline(usdrAgencyId, anyChecklistItemId, { dueDate: '06/01/2031' });
            expect(response.status).to.equal(400);
        });

        it('rejects an invalid completion status', async () => {
            const response = await patchDeadline(usdrAgencyId, anyChecklistItemId, { completionStatus: 'banana' });
            expect(response.status).to.equal(400);
        });

        it('rejects an unknown field', async () => {
            const response = await patchDeadline(usdrAgencyId, anyChecklistItemId, { verificationStatus: 'verified' });
            expect(response.status).to.equal(400);
            const json = await response.json();
            expect(json.error.details[0].field).to.equal('verificationStatus');
        });

        it('rejects an empty body', async () => {
            const response = await patchDeadline(usdrAgencyId, anyChecklistItemId, {});
            expect(response.status).to.equal(400);
        });

        it('returns 404 for a checklist item that does not exist in the organization', async () => {
            const response = await patchDeadline(usdrAgencyId, 999999, { completionStatus: 'completed' });
            expect(response.status).to.equal(404);
            const json = await response.json();
            expect(json.error.code).to.equal('NOT_FOUND');
        });

        it('rejects a request for an organization outside the user\'s tenant', async () => {
            const response = await patchDeadline(otherTenantAgencyId, anyChecklistItemId, { completionStatus: 'completed' });
            expect(response.status).to.equal(403);
        });

        it('rejects an unauthenticated request', async () => {
            const response = await patchDeadline(
                usdrAgencyId,
                anyChecklistItemId,
                { completionStatus: 'completed' },
                { headers: { 'Content-Type': 'application/json' } },
            );
            expect(response.status).to.equal(403);
        });

        it('updates dueDate and completionStatus together in one request', async () => {
            const id = await findIdByDescription('Complete civil rights compliance self-assessment');

            const response = await patchDeadline(usdrAgencyId, id, { dueDate: '2031-02-02', completionStatus: 'inProgress' });
            expect(response.status).to.equal(200);

            const { deadline } = await response.json();
            expect(deadline.dueDate).to.equal('2031-02-02');
            expect(deadline.completionStatus).to.equal('inProgress');
            expect(deadline.verificationStatus).to.equal('unverified');
        });

        it('rejects a non-numeric checklistItemId', async () => {
            const response = await patchDeadline(usdrAgencyId, 'abc', { completionStatus: 'completed' });
            expect(response.status).to.equal(400);
        });

        it('rejects a non-integer checklistItemId', async () => {
            const response = await patchDeadline(usdrAgencyId, '1.5', { completionStatus: 'completed' });
            expect(response.status).to.equal(400);
        });

        it('completing a verified item leaves it verified, matching a subsequent GET', async () => {
            const id = await findIdByDescription('Submit quarterly financial status report');

            const patchResponse = await patchDeadline(usdrAgencyId, id, { completionStatus: 'completed' });
            expect(patchResponse.status).to.equal(200);
            const { deadline: patched } = await patchResponse.json();
            expect(patched.verificationStatus).to.equal('verified');
            expect(patched.completionStatus).to.equal('completed');
            expect(patched.completedAt).to.not.equal(null);

            const getResponse = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin, { status: 'completed' });
            const { data } = await getResponse.json();
            const fetched = data.find((item) => item.checklistItemId === id);
            expect(fetched).to.not.equal(undefined);
            expect(fetched.verificationStatus).to.equal('verified');
            expect(fetched.completionStatus).to.equal('completed');
            expect(fetched.dueDate).to.equal(patched.dueDate);
            expect(fetched.completedAt).to.equal(patched.completedAt);
        });

        it('correcting a due date removes the item from the published feed until re-verified', async () => {
            const id = await findIdByDescription('Submit annual audit certification');

            const patchResponse = await patchDeadline(usdrAgencyId, id, { dueDate: '2032-03-01' });
            expect(patchResponse.status).to.equal(200);
            const { deadline: patched } = await patchResponse.json();
            expect(patched.verificationStatus).to.equal('unverified');

            const getResponse = await fetchApi('/compliance/deadlines', usdrAgencyId, fetchOptions.admin);
            const { data } = await getResponse.json();
            expect(data.find((item) => item.checklistItemId === id)).to.equal(undefined);
        });

        context('cross-organization access to a real checklist item', () => {
            let otherOrgItemId;

            before(async () => {
                const [row] = await knex('checklist_items_placeholder').insert({
                    agency_id: otherTenantAgencyId,
                    category: 'Compliance',
                    description: 'Cross-organization isolation test item',
                    due_date: '2031-01-01',
                    completion_status: 'notStarted',
                    verification_status: 'verified',
                }).returning('*');
                otherOrgItemId = row.id;
            });

            after(async () => {
                await knex('checklist_items_placeholder').where({ id: otherOrgItemId }).del();
            });

            it('returns 404 and leaves the item unchanged when patched through a different organization\'s route', async () => {
                const response = await patchDeadline(usdrAgencyId, otherOrgItemId, { completionStatus: 'completed' });
                expect(response.status).to.equal(404);

                const row = await knex('checklist_items_placeholder').where({ id: otherOrgItemId }).first();
                expect(row.completion_status).to.equal('notStarted');
            });
        });
    });
});
