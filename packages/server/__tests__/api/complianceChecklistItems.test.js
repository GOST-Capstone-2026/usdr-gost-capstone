const path = require('path');
const { expect } = require('chai');
const { getSessionCookie, makeTestServer, knex } = require('./utils');
const db = require('../../src/db');

// Built inline, matching checklistItemSchema.js's createChecklistItem() shape (AN-11), rather
// than importing it: AN-11 and AN-12 are separate branches/pull requests, each starting clean
// from develop, so AN-12's own tests must not depend on a module that only exists on AN-11's
// branch.
function buildChecklistItem({
    category, description, found, sources = [], dueDate = null, possiblyAffectedByQualityIssue = false,
}) {
    return {
        category,
        description,
        found,
        sources,
        possiblyAffectedByQualityIssue,
        dueDate,
    };
}

const FIXTURE_PDF_PATH = path.join(__dirname, '..', 'fixtures', 'an08-sample.pdf');

// AN-12 added the real checklist_items storage functions, but the HTTP routes that will call
// them (AN-14's generation, AN-15's edit/verify controls) do not exist yet. This test exercises
// the storage layer directly, the same way it will eventually be reached through those routes.
describe('checklist item storage', () => {
    const agencyId = 0;
    const baseUrl = `/api/organizations/${agencyId}/compliance`;
    let server;
    let cookie;
    let adminUserId;
    let documentId;

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        adminUserId = await knex('users').select('id').where({ email: 'grant-admin@usdigitalresponse.org' })
            .first()
            .then((row) => row.id);
        server = await makeTestServer();

        const uploadResponse = await server.post(`${baseUrl}/documents`)
            .set('Cookie', cookie)
            .field('grantId', '335255')
            .attach('file', FIXTURE_PDF_PATH);
        documentId = uploadResponse.body.document.id;
    });

    after(async () => {
        if (documentId) {
            await knex('checklist_items').where({ document_id: documentId }).del();
            await knex('grant_documents').where({ id: documentId }).del();
        }
        server.stop();
    });

    it('saves one initial checklist with storage-assigned audit fields even when analyses overlap', async () => {
        const empty = await db.createInitialChecklistItems({ documentId, items: [] });
        expect(empty).to.deep.equal([]);
        const request = {
            documentId,
            items: [
                buildChecklistItem({
                    category: 'reporting',
                    description: 'Submit quarterly performance reports within 30 days after each quarter.',
                    found: true,
                    sources: [{ documentId, pageNumber: 14, excerpt: 'Quarterly performance reports are due...' }],
                    dueDate: '2026-12-31',
                }),
                buildChecklistItem({
                    category: 'costShare',
                    description: 'Not found in the processed notice.',
                    found: false,
                }),
            ],
        };
        const saved = await Promise.all([
            db.createInitialChecklistItems(request),
            db.createInitialChecklistItems(request),
        ]);
        expect(saved.map((batch) => batch.length).sort()).to.deep.equal([0, 2]);
        const items = saved.flat();

        expect(items).to.have.length(2);
        const [reporting, costShare] = items;

        expect(reporting.document_id).to.equal(documentId);
        expect(reporting.category).to.equal('reporting');
        expect(reporting.found).to.equal(true);
        expect(reporting.sources).to.deep.equal([
            { documentId, pageNumber: 14, excerpt: 'Quarterly performance reports are due...' },
        ]);
        expect(reporting.due_date).to.equal('2026-12-31');
        expect(reporting.completion_status).to.equal('notStarted');
        expect(reporting.verification_status).to.equal('unverified');
        expect(reporting.is_user_edited).to.equal(false);
        expect(reporting.verified_by).to.equal(null);
        expect(reporting.version).to.equal(1);
        expect(reporting.id).to.be.a('number');
        expect(reporting.created_at).to.not.equal(null);

        expect(costShare.found).to.equal(false);
        expect(costShare.sources).to.deep.equal([]);
        expect(costShare.due_date).to.equal(null);
    });

    it('scopes reads to the organization that owns the document', async () => {
        const ownOrgItems = await db.getChecklistItemsForDocument({ documentId, agencyId });
        expect(ownOrgItems).to.have.length(2);

        const otherOrgItems = await db.getChecklistItemsForDocument({ documentId, agencyId: 384 });
        expect(otherOrgItems).to.have.length(0);
    });

    it('verifying an item sets verifiedBy/verifiedAt and bumps version without marking it user-edited', async () => {
        const [reporting] = await db.getChecklistItemsForDocument({ documentId, agencyId });

        const updated = await db.updateChecklistItem({
            itemId: reporting.id,
            agencyId,
            expectedVersion: reporting.version,
            verifiedByUserId: adminUserId,
            verificationStatus: 'verified',
        });

        expect(updated.verification_status).to.equal('verified');
        expect(updated.verified_by).to.equal(adminUserId);
        expect(updated.verified_at).to.not.equal(null);
        expect(updated.is_user_edited).to.equal(false);
        expect(updated.version).to.equal(reporting.version + 1);
    });

    it('editing content marks the item user-edited and leaves verification alone', async () => {
        const [, costShare] = await db.getChecklistItemsForDocument({ documentId, agencyId });

        const updated = await db.updateChecklistItem({
            itemId: costShare.id,
            agencyId,
            expectedVersion: costShare.version,
            description: 'A 10% local cost share is required per the notice.',
            userNotes: 'Confirmed with the program officer.',
        });

        expect(updated.description).to.equal('A 10% local cost share is required per the notice.');
        expect(updated.user_notes).to.equal('Confirmed with the program officer.');
        expect(updated.is_user_edited).to.equal(true);
        expect(updated.verification_status).to.equal('unverified');
        expect(updated.version).to.equal(costShare.version + 1);
    });

    it('sets and clears completedAt as completionStatus moves through states', async () => {
        const [reporting] = await db.getChecklistItemsForDocument({ documentId, agencyId });

        const completed = await db.updateChecklistItem({
            itemId: reporting.id,
            agencyId,
            expectedVersion: reporting.version,
            completionStatus: 'completed',
        });
        expect(completed.completion_status).to.equal('completed');
        expect(completed.completed_at).to.not.equal(null);

        const reopened = await db.updateChecklistItem({
            itemId: reporting.id,
            agencyId,
            expectedVersion: completed.version,
            completionStatus: 'inProgress',
        });
        expect(reopened.completion_status).to.equal('inProgress');
        expect(reopened.completed_at).to.equal(null);
    });

    it('rejects a stale expectedVersion instead of silently overwriting a concurrent edit', async () => {
        const [reporting] = await db.getChecklistItemsForDocument({ documentId, agencyId });

        const result = await db.updateChecklistItem({
            itemId: reporting.id,
            agencyId,
            expectedVersion: reporting.version - 1,
            userNotes: 'This should not be saved.',
        });

        expect(result).to.equal(null);
    });

    it('does not let a different organization update another organization\'s checklist item', async () => {
        const [reporting] = await db.getChecklistItemsForDocument({ documentId, agencyId });

        const result = await db.updateChecklistItem({
            itemId: reporting.id,
            agencyId: 384,
            expectedVersion: reporting.version,
            userNotes: 'Should not apply.',
        });

        expect(result).to.equal(null);
    });
});

// AN-16: the Checklist Contract's GET .../checklist-export, a readable CSV download over the
// same storage the tests above exercise directly, following the CSV download convention
// routes/grants.js already uses rather than inventing a new export mechanism.
describe('checklist export API', () => {
    const agencyId = 0;
    const otherAgencyId = 384;
    const baseUrl = `/api/organizations/${agencyId}/compliance`;
    const otherBaseUrl = `/api/organizations/${otherAgencyId}/compliance`;
    let server;
    let cookie;
    let nvCookie;
    let adminUser;
    let documentId;
    let emptyDocumentId;

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        nvCookie = await getSessionCookie('user2@nv.example.com');
        adminUser = await knex('users').select('id', 'name', 'email').where({ email: 'grant-admin@usdigitalresponse.org' }).first();
        server = await makeTestServer();

        const upload = await server.post(`${baseUrl}/documents`)
            .set('Cookie', cookie)
            .field('grantId', '335255')
            .attach('file', FIXTURE_PDF_PATH);
        documentId = upload.body.document.id;

        // A second real upload of the same fixture bytes would collide on the (agencyId, sha256)
        // unique constraint (AN-05), so the empty-checklist case is a document row inserted
        // directly instead, needing no real PDF content since nothing here reads it.
        [{ id: emptyDocumentId }] = await knex('grant_documents').insert({
            agency_id: agencyId,
            grant_id: '335255',
            uploaded_by: adminUser.id,
            filename: 'empty-checklist-notice.pdf',
            mime_type: 'application/pdf',
            size_bytes: 0,
            sha256: 'an16-empty-checklist-document',
            storage_bucket: 'grant-documents',
            storage_key: 'an16-empty-checklist-document.pdf',
        }).returning('id');

        await knex('checklist_items').insert([
            {
                document_id: documentId,
                category: 'reporting',
                description: 'Submit quarterly performance reports within 30 days after each quarter.',
                found: true,
                sources: JSON.stringify([{ documentId, pageNumber: 14, excerpt: 'Quarterly reports are due...' }]),
                possibly_affected_by_quality_issue: false,
                due_date: '2026-12-31',
                completion_status: 'inProgress',
                user_notes: 'Confirmed with the program officer.',
                is_user_edited: true,
                verification_status: 'verified',
                verified_by: adminUser.id,
                verified_at: new Date(),
            },
            {
                document_id: documentId,
                category: 'costShare',
                description: 'Not found in the processed notice.',
                found: false,
                sources: JSON.stringify([]),
                completion_status: 'notStarted',
            },
        ]);
    });

    after(async () => {
        if (documentId) {
            await knex('checklist_items').where({ document_id: documentId }).del();
            await knex('grant_documents').where({ id: documentId }).del();
        }
        if (emptyDocumentId) {
            await knex('grant_documents').where({ id: emptyDocumentId }).del();
        }
        server.stop();
    });

    it('downloads a readable CSV with one row per checklist item', async () => {
        const response = await server.get(`${baseUrl}/documents/${documentId}/checklist-export`).set('Cookie', cookie);

        expect(response.status).to.equal(200);
        expect(response.headers['content-type']).to.match(/text\/csv/);
        expect(response.headers['content-disposition']).to.equal(`attachment; filename=checklist-document-${documentId}.csv`);

        const lines = response.text.trim().split('\n');
        expect(lines).to.have.length(3);
        expect(lines[0]).to.equal('Category,Description,Found,Source Citations,Possibly Affected By Quality Issue,Due Date,Completion Status,Verification Status,Verified By,Verified At,User Notes,Edited By User');

        expect(response.text).to.include('Reporting,Submit quarterly performance reports within 30 days after each quarter.,Yes,p.14: Quarterly reports are due...,No,2026-12-31,In progress,verified,');
        expect(response.text).to.include(adminUser.name || adminUser.email);
        // verifiedAt must be a real readable date, not a Date object silently cast to an epoch
        // number by csv-stringify.
        expect(response.text).to.match(/,\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z,Confirmed with the program officer\.,Yes/);
        expect(response.text).to.include('Cost share,Not found in the processed notice.,No,,No,,Not started,unverified,,,,No');
    });

    it('still returns a well-formed CSV with just a header when the document has no checklist items yet', async () => {
        const response = await server.get(`${baseUrl}/documents/${emptyDocumentId}/checklist-export`).set('Cookie', cookie);

        expect(response.status).to.equal(200);
        const lines = response.text.trim().split('\n');
        expect(lines[0]).to.equal('Category,Description,Found,Source Citations,Possibly Affected By Quality Issue,Due Date,Completion Status,Verification Status,Verified By,Verified At,User Notes,Edited By User');
        expect(lines).to.have.length(2);
    });

    it('returns 404 for a document that does not exist', async () => {
        const response = await server.get(`${baseUrl}/documents/999999999/checklist-export`).set('Cookie', cookie);
        expect(response.status).to.equal(404);
    });

    it('does not let a different organization export another organization\'s checklist', async () => {
        const response = await server.get(`${otherBaseUrl}/documents/${documentId}/checklist-export`).set('Cookie', nvCookie);
        expect(response.status).to.equal(404);
    });
});
