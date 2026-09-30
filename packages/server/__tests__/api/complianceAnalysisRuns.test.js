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

describe('grant document analysis-runs API', () => {
    const agencyId = 0;
    const baseUrl = `/api/organizations/${agencyId}/compliance`;
    let server;
    let cookie;
    let nvCookie;
    let documentId;

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        // A real user of a different agency (Nevada, id 384), to prove our own scoping in
        // getAnalysisRun rejects a cross-organization lookup, separately from the broader
        // access-control layer that already blocks a user from selecting an agency at all.
        nvCookie = await getSessionCookie('user2@nv.example.com');
        server = await makeTestServer();
    });

    after(async () => {
        if (documentId) {
            await knex('analysis_runs').where({ document_id: documentId }).del();
            await knex('grant_document_pages').where({ document_id: documentId }).del();
            await knex('grant_documents').where({ id: documentId }).del();
        }
        server.stop();
    });

    it('uploads fast without processing, then completes an analysis run', async function testCase() {
        this.timeout(15000);

        const uploadResponse = await server.post(`${baseUrl}/documents`)
            .set('Cookie', cookie)
            .field('grantId', '335255')
            .attach('file', FIXTURE_PDF_PATH);
        expect(uploadResponse.status).to.equal(201);
        expect(uploadResponse.body.document.pageCount).to.equal(null);
        expect(uploadResponse.body.document.extractionQuality).to.equal('unknown');
        documentId = uploadResponse.body.document.id;

        const startResponse = await server.post(`${baseUrl}/documents/${documentId}/analysis-runs`).set('Cookie', cookie);
        expect(startResponse.status).to.equal(202);
        expect(startResponse.body.analysisRun.status).to.equal('queued');
        const { id: runId } = startResponse.body.analysisRun;

        const finished = await waitForAnalysisRun(server, `${baseUrl}/analysis-runs/${runId}`, cookie);
        expect(finished.status).to.equal('completed');
        expect(finished.startedAt).to.not.equal(null);
        expect(finished.completedAt).to.not.equal(null);

        const documentResponse = await server.get(`${baseUrl}/documents/${documentId}`).set('Cookie', cookie);
        expect(documentResponse.body.document.pageCount).to.equal(2);
        expect(documentResponse.body.document.extractionQuality).to.equal('readable');

        const pageRows = await knex('grant_document_pages').where({ document_id: documentId }).orderBy('page_number');
        expect(pageRows).to.have.length(2);
    });

    it('returns 404 starting an analysis run for a document that does not exist', async () => {
        const response = await server.post(`${baseUrl}/documents/999999999/analysis-runs`).set('Cookie', cookie);
        expect(response.status).to.equal(404);
    });

    it('returns 404 polling an analysis run that does not exist', async () => {
        const response = await server.get(`${baseUrl}/analysis-runs/999999999`).set('Cookie', cookie);
        expect(response.status).to.equal(404);
    });

    it('does not let a different organization poll another organization\'s analysis run', async function testCase() {
        this.timeout(15000);
        // Reuses the document from the first test (a document can have more than one analysis
        // run over time), instead of re-uploading the same fixture bytes, which would trip the
        // AN-05 duplicate-document rule (one agency can't upload identical bytes twice).
        const startResponse = await server.post(`${baseUrl}/documents/${documentId}/analysis-runs`).set('Cookie', cookie);
        expect(startResponse.status).to.equal(202);
        const { id: runId } = startResponse.body.analysisRun;

        const crossOrgResponse = await server.get(`/api/organizations/384/compliance/analysis-runs/${runId}`).set('Cookie', nvCookie);
        expect(crossOrgResponse.status).to.equal(404);
    });
});
