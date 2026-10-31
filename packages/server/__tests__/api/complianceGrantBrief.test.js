const path = require('path');
const { expect } = require('chai');
const { getSessionCookie, makeTestServer, knex } = require('./utils');

const FIXTURE_PDF_PATH = path.join(__dirname, '..', 'fixtures', 'an08-sample.pdf');

async function waitForAnalysisRun(server, url, cookie) {
    for (let attempt = 0; attempt < 30; attempt += 1) {
        // eslint-disable-next-line no-await-in-loop
        const response = await server.get(url).set('Cookie', cookie);
        const { analysisRun } = response.body;
        if (analysisRun.status === 'completed' || analysisRun.status === 'failed') {
            return analysisRun;
        }
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => { setTimeout(resolve, 100); });
    }
    throw new Error('analysis run did not finish in time');
}

describe('grant brief API', () => {
    const agencyId = 0;
    const baseUrl = `/api/organizations/${agencyId}/compliance`;
    let server;
    let cookie;
    let nvCookie;
    let documentId;

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        nvCookie = await getSessionCookie('user2@nv.example.com');
        server = await makeTestServer();
    });

    after(async () => {
        if (documentId) {
            await knex('grant_briefs').where({ document_id: documentId }).del();
            await knex('analysis_runs').where({ document_id: documentId }).del();
            await knex('grant_document_pages').where({ document_id: documentId }).del();
            await knex('grant_documents').where({ id: documentId }).del();
        }
        server.stop();
    });

    it('returns 404 before any analysis has run', async () => {
        const uploadResponse = await server.post(`${baseUrl}/documents`)
            .set('Cookie', cookie)
            .field('grantId', '335255')
            .attach('file', FIXTURE_PDF_PATH);
        documentId = uploadResponse.body.document.id;

        const response = await server.get(`${baseUrl}/documents/${documentId}/brief`).set('Cookie', cookie);
        expect(response.status).to.equal(404);
    });

    it('generates and saves a real grant brief as part of the analysis run', async function testCase() {
        this.timeout(15000);

        const startResponse = await server.post(`${baseUrl}/documents/${documentId}/analysis-runs`).set('Cookie', cookie);
        const { id: runId } = startResponse.body.analysisRun;
        const finished = await waitForAnalysisRun(server, `${baseUrl}/analysis-runs/${runId}`, cookie);
        expect(finished.status).to.equal('completed');

        const briefResponse = await server.get(`${baseUrl}/documents/${documentId}/brief`).set('Cookie', cookie);
        expect(briefResponse.status).to.equal(200);

        const { brief } = briefResponse.body;
        expect(brief.documentId).to.equal(documentId);
        expect(brief.grantId).to.equal('335255');
        expect(brief.runId).to.equal(runId);
        expect(brief.verificationStatus).to.equal('unverified');
        expect(brief.promptVersion).to.equal('grant-brief-v1');
        // The dev/test environment has no AI_PROVIDER configured, so this ran against the mock
        // provider: it proves the whole real pipeline (audit logging included) runs without
        // error, even though the mock's canned text is not real JSON for it to find facts in.
        expect(brief.notFoundFields).to.deep.equal([
            'purpose', 'eligibility', 'fundingRange', 'keyDates', 'costShare', 'keyRequirements',
        ]);

        const auditRows = await knex('ai_audit_records').where({ task: 'grantBrief' });
        expect(auditRows.length).to.be.greaterThan(0);
        auditRows.forEach((row) => {
            expect(row.grant_id).to.equal('335255');
            expect(row.prompt_version).to.equal('grant-brief-v1');
        });
    });

    it('does not let a different organization view another organization\'s brief', async () => {
        const response = await server.get(`/api/organizations/384/compliance/documents/${documentId}/brief`).set('Cookie', nvCookie);
        expect(response.status).to.equal(404);
    });
});
