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

// AN-12 added the real checklist_items storage functions; AN-14's generation and AN-15's HTTP
// routes reach them the same way this test exercises the storage layer directly.
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

// AN-15: the Checklist Contract's HTTP routes over the same storage layer the test above
// exercises directly. GET lists a document's items; PATCH edits, annotates, verifies, or rejects
// one by its own id, matching docs/g32-shared-api-contracts.md, "Checklist Contract".
describe('checklist items API', () => {
    const agencyId = 0;
    const otherAgencyId = 384;
    const baseUrl = `/api/organizations/${agencyId}/compliance`;
    const otherBaseUrl = `/api/organizations/${otherAgencyId}/compliance`;
    let server;
    let cookie;
    let nvCookie;
    let adminUserId;
    let documentId;
    let verifiableItem;
    let unverifiableItem;
    let notFoundItem;

    const PAGE_TEXT = 'Quarterly performance reports are due within 30 days after each quarter ends.';

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        nvCookie = await getSessionCookie('user2@nv.example.com');
        adminUserId = await knex('users').select('id').where({ email: 'grant-admin@usdigitalresponse.org' })
            .first()
            .then((row) => row.id);
        server = await makeTestServer();

        const uploadResponse = await server.post(`${baseUrl}/documents`)
            .set('Cookie', cookie)
            .field('grantId', '335255')
            .attach('file', FIXTURE_PDF_PATH);
        documentId = uploadResponse.body.document.id;

        await knex('grant_document_pages').insert({
            document_id: documentId, page_number: 1, text: PAGE_TEXT, char_count: PAGE_TEXT.length,
        });

        const [verifiable, unverifiable, notFound] = await knex('checklist_items').insert([
            {
                document_id: documentId,
                category: 'reporting',
                description: 'Submit quarterly performance reports within 30 days after each quarter.',
                found: true,
                sources: JSON.stringify([{ documentId, pageNumber: 1, excerpt: PAGE_TEXT }]),
                completion_status: 'notStarted',
            },
            {
                document_id: documentId,
                category: 'costShare',
                description: 'A 10% local cost share is required.',
                found: true,
                sources: JSON.stringify([{ documentId, pageNumber: 1, excerpt: 'This sentence never appears on the page.' }]),
                completion_status: 'notStarted',
            },
            {
                document_id: documentId,
                category: 'eligibility',
                description: 'Not found in the processed notice.',
                found: false,
                sources: JSON.stringify([]),
                completion_status: 'notStarted',
            },
        ]).returning('*');
        verifiableItem = verifiable;
        unverifiableItem = unverifiable;
        notFoundItem = notFound;
    });

    after(async () => {
        if (documentId) {
            await knex('checklist_items').where({ document_id: documentId }).del();
            await knex('grant_document_pages').where({ document_id: documentId }).del();
            await knex('grant_documents').where({ id: documentId }).del();
        }
        server.stop();
    });

    describe('GET /documents/:documentId/checklist-items', () => {
        it('returns every item for the document, including one with no citation', async () => {
            const response = await server.get(`${baseUrl}/documents/${documentId}/checklist-items`).set('Cookie', cookie);
            expect(response.status).to.equal(200);
            expect(response.body.data).to.have.length(3);
            expect(response.body.pagination).to.deep.equal({
                currentPage: 1, perPage: 3, total: 3, lastPage: 1,
            });

            const item = response.body.data.find((row) => row.id === verifiableItem.id);
            expect(item).to.deep.include({
                id: verifiableItem.id,
                organizationId: agencyId,
                documentId,
                grantId: '335255',
                category: 'reporting',
                found: true,
                completionStatus: 'notStarted',
                isUserEdited: false,
                verificationStatus: 'unverified',
                verifiedBy: null,
                version: 1,
            });
            expect(item.sources).to.deep.equal([{ documentId, pageNumber: 1, excerpt: PAGE_TEXT }]);
        });

        it('returns 404 for a document that does not exist', async () => {
            const response = await server.get(`${baseUrl}/documents/999999999/checklist-items`).set('Cookie', cookie);
            expect(response.status).to.equal(404);
        });

        it('does not let a different organization list another organization\'s checklist items', async () => {
            const response = await server.get(`${otherBaseUrl}/documents/${documentId}/checklist-items`).set('Cookie', nvCookie);
            expect(response.status).to.equal(404);
        });
    });

    describe('PATCH /checklist-items/:itemId', () => {
        it('rejects an unknown field', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: 1, category: 'other' });
            expect(response.status).to.equal(400);
            expect(response.body.error.details).to.deep.equal([{ field: 'category', issue: 'unsupported field' }]);
        });

        it('requires expectedVersion', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', cookie)
                .send({ userNotes: 'missing a version' });
            expect(response.status).to.equal(400);
            expect(response.body.error.details).to.deep.equal([{ field: 'expectedVersion', issue: 'must be a positive integer' }]);
        });

        it('requires at least one editable field', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: 1 });
            expect(response.status).to.equal(400);
            expect(response.body.error.details[0].field).to.equal('body');
        });

        it('rejects an invalid dueDate', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: 1, dueDate: 'not-a-date' });
            expect(response.status).to.equal(400);
            expect(response.body.error.details).to.deep.equal([{ field: 'dueDate', issue: 'must be a valid YYYY-MM-DD date, or null' }]);
        });

        it('rejects an invalid completionStatus', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: 1, completionStatus: 'done' });
            expect(response.status).to.equal(400);
            expect(response.body.error.details).to.deep.equal([{ field: 'completionStatus', issue: 'must be one of notStarted, inProgress, completed, notApplicable' }]);
        });

        it('rejects an invalid verificationStatus', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: 1, verificationStatus: 'approved' });
            expect(response.status).to.equal(400);
            expect(response.body.error.details).to.deep.equal([{ field: 'verificationStatus', issue: 'must be one of unverified, verified, rejected' }]);
        });

        it('returns 404 for an item that does not exist', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/999999999`)
                .set('Cookie', cookie)
                .send({ expectedVersion: 1, userNotes: 'anything' });
            expect(response.status).to.equal(404);
        });

        it('does not let a different organization patch another organization\'s checklist item', async () => {
            const response = await server.patch(`${otherBaseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', nvCookie)
                .send({ expectedVersion: 1, userNotes: 'should not apply' });
            expect(response.status).to.equal(404);
        });

        it('edits the description and notes, marking the item user-edited without touching verification', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${notFoundItem.id}`)
                .set('Cookie', cookie)
                .send({
                    expectedVersion: notFoundItem.version,
                    description: 'Confirmed not applicable to this notice.',
                    userNotes: 'Checked with the program officer.',
                });
            expect(response.status).to.equal(200);
            expect(response.body.checklistItem).to.deep.include({
                id: notFoundItem.id,
                description: 'Confirmed not applicable to this notice.',
                userNotes: 'Checked with the program officer.',
                isUserEdited: true,
                verificationStatus: 'unverified',
                version: notFoundItem.version + 1,
            });
            notFoundItem = { ...notFoundItem, version: notFoundItem.version + 1 };
        });

        it('clears a due date by sending null', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${verifiableItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: verifiableItem.version, dueDate: null });
            expect(response.status).to.equal(200);
            expect(response.body.checklistItem.dueDate).to.equal(null);
            verifiableItem = { ...verifiableItem, version: verifiableItem.version + 1 };
        });

        it('rejects a stale expectedVersion with a version conflict instead of overwriting it', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${verifiableItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: verifiableItem.version - 1, userNotes: 'should not be saved' });
            expect(response.status).to.equal(409);
            expect(response.body.error.code).to.equal('VERSION_CONFLICT');
        });

        it('refuses to verify a found item whose citation does not check out', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${unverifiableItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: unverifiableItem.version, verificationStatus: 'verified' });
            expect(response.status).to.equal(422);
            expect(response.body.error.code).to.equal('SOURCE_NOT_VERIFIABLE');
        });

        it('rejects an item without needing its citation to check out, since rejecting is not endorsing it', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${unverifiableItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: unverifiableItem.version, verificationStatus: 'rejected' });
            expect(response.status).to.equal(200);
            expect(response.body.checklistItem.verificationStatus).to.equal('rejected');
            expect(response.body.checklistItem.verifiedBy).to.equal(adminUserId);
        });

        it('verifies a found item whose citation checks out against the real page text', async () => {
            const response = await server.patch(`${baseUrl}/checklist-items/${verifiableItem.id}`)
                .set('Cookie', cookie)
                .send({ expectedVersion: verifiableItem.version, verificationStatus: 'verified' });
            expect(response.status).to.equal(200);
            expect(response.body.checklistItem).to.deep.include({
                id: verifiableItem.id,
                verificationStatus: 'verified',
                verifiedBy: adminUserId,
                // Already true from the earlier "clears a due date" test on this same item;
                // verifying an item is not itself a content edit, but it also does not undo one.
                isUserEdited: true,
                version: verifiableItem.version + 1,
            });
            expect(response.body.checklistItem.verifiedAt).to.not.equal(null);
        });
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

// AN-17 follow-up (Connor's report): a retry after a partially-failed analysis run must be able
// to add the obligations it missed the first time, without duplicating what already saved
// successfully or touching anything a person has since edited or verified.
describe('addMissingChecklistItems (AN-17 follow-up retry behavior)', () => {
    const agencyId = 0;
    let server;
    let cookie;
    let documentId;

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        server = await makeTestServer();

        const uploadResponse = await server.post(`/api/organizations/${agencyId}/compliance/documents`)
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

    it('adds only the items a retry found that an earlier, incomplete run missed', async () => {
        const [reporting] = await knex('checklist_items').insert({
            document_id: documentId,
            category: 'reporting',
            description: 'Submit quarterly performance reports within 30 days after each quarter.',
            found: true,
            sources: JSON.stringify([{ documentId, pageNumber: 1, excerpt: 'Quarterly reports are due...' }]),
            verification_status: 'verified',
        }).returning('*');

        const saved = await db.addMissingChecklistItems({
            documentId,
            items: [
                buildChecklistItem({
                    // Same category and cited page as the existing item: treated as the same
                    // obligation the first run already found, not added again.
                    category: 'reporting',
                    description: 'Submit quarterly performance reports within 30 days after each quarter.',
                    found: true,
                    sources: [{ documentId, pageNumber: 1, excerpt: 'Quarterly reports must be submitted...' }],
                }),
                buildChecklistItem({
                    // A different category and page: the obligation the first, incomplete run
                    // never reached.
                    category: 'recordRetention',
                    description: 'Retain records for three years after closeout.',
                    found: true,
                    sources: [{ documentId, pageNumber: 5, excerpt: 'Records must be retained for three years' }],
                }),
            ],
        });

        expect(saved).to.have.length(1);
        expect(saved[0].category).to.equal('recordRetention');

        const allItems = await db.getChecklistItemsForDocument({ documentId, agencyId });
        expect(allItems).to.have.length(2);

        const unchangedReporting = allItems.find((item) => item.id === reporting.id);
        expect(unchangedReporting.version).to.equal(reporting.version);
        expect(unchangedReporting.verification_status).to.equal('verified');
        expect(unchangedReporting.description).to.equal(reporting.description);
    });

    it('adds nothing and returns an empty array when every candidate duplicates an item already on file', async () => {
        const saved = await db.addMissingChecklistItems({
            documentId,
            items: [
                buildChecklistItem({
                    category: 'recordRetention',
                    // Worded differently than the saved "Retain records for three years after
                    // closeout.", but still describing the same obligation: shares enough of its
                    // meaningful wording (records, three, years, closeout) to count as a dup.
                    description: 'Records related to this award must be kept for a period of three years following closeout.',
                    found: true,
                    sources: [{ documentId, pageNumber: 5, excerpt: 'different excerpt, same page' }],
                }),
            ],
        });

        expect(saved).to.deep.equal([]);
        const allItems = await db.getChecklistItemsForDocument({ documentId, agencyId });
        expect(allItems).to.have.length(2);
    });

    it('returns an empty array for a document that does not exist, instead of throwing', async () => {
        const saved = await db.addMissingChecklistItems({
            documentId: 999999999,
            items: [buildChecklistItem({
                category: 'deadline', description: 'Should never be saved.', found: true, sources: [{ documentId: 999999999, pageNumber: 1, excerpt: 'x' }],
            })],
        });
        expect(saved).to.deep.equal([]);
    });
});

// Connor's bug report on pull request #57: a long page split across two chunks can state two
// different obligations in the same category. When one chunk fails and a retry later succeeds on
// both, the old category+page-only dedup key treated both as duplicates of the one obligation
// already on file and dropped the second, genuinely new one. Isolated in its own document rather
// than reusing the block above's, since that block's tests depend on each other's exact item
// counts.
describe('addMissingChecklistItems (distinguishes two obligations sharing a page and category)', () => {
    const agencyId = 0;
    let server;
    let cookie;
    let documentId;

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        server = await makeTestServer();

        const uploadResponse = await server.post(`/api/organizations/${agencyId}/compliance/documents`)
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

    it('keeps a second, different obligation on the same page and category instead of dropping it alongside a true duplicate', async () => {
        await knex('checklist_items').insert({
            document_id: documentId,
            category: 'submission',
            description: 'Submit the original signed SF-424 application form with an original ink signature.',
            found: true,
            sources: JSON.stringify([{ documentId, pageNumber: 8, excerpt: 'Submit the signed SF-424...' }]),
        });

        const saved = await db.addMissingChecklistItems({
            documentId,
            items: [
                buildChecklistItem({
                    // Same obligation as the item already on file, reworded: the chunk that
                    // already succeeded on the first, incomplete run finding it again.
                    category: 'submission',
                    description: 'Submit the signed SF-424 application form in ink, not a copy.',
                    found: true,
                    sources: [{ documentId, pageNumber: 8, excerpt: 'Submit the signed SF-424...' }],
                }),
                buildChecklistItem({
                    // A genuinely different obligation, sharing only the category and page: the
                    // one the earlier run's failed chunk never reached.
                    category: 'submission',
                    description: 'Include a certificate of insurance covering the full project period.',
                    found: true,
                    sources: [{ documentId, pageNumber: 8, excerpt: 'A certificate of insurance...' }],
                }),
            ],
        });

        expect(saved).to.have.length(1);
        expect(saved[0].description).to.equal('Include a certificate of insurance covering the full project period.');

        const allItems = await db.getChecklistItemsForDocument({ documentId, agencyId });
        const submissionItems = allItems.filter((item) => item.category === 'submission');
        expect(submissionItems).to.have.length(2);
    });
});

// Connor's second round of feedback on pull request #57: two more retry cases the first fix
// missed. Isolated in its own document for the same reason as the block above.
describe('addMissingChecklistItems (edited items and numeric deadlines)', () => {
    const agencyId = 0;
    let server;
    let cookie;
    let documentId;

    before(async function beforeHook() {
        this.timeout(15000);
        cookie = await getSessionCookie('grant-admin@usdigitalresponse.org');
        server = await makeTestServer();

        const uploadResponse = await server.post(`/api/organizations/${agencyId}/compliance/documents`)
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

    it('recognizes an item by its original source citation after a person has reworded it past recognition', async () => {
        const [edited] = await knex('checklist_items').insert({
            document_id: documentId,
            category: 'reporting',
            // Reworded by a person into their own words, nothing like the AI's original phrasing.
            description: 'Already checked, we file this one on time every quarter.',
            found: true,
            sources: JSON.stringify([{ documentId, pageNumber: 3, excerpt: 'Quarterly performance reports are due within 30 days after each quarter.' }]),
            verification_status: 'verified',
            is_user_edited: true,
        }).returning('*');

        const saved = await db.addMissingChecklistItems({
            documentId,
            items: [
                buildChecklistItem({
                    category: 'reporting',
                    description: 'Submit quarterly performance reports to the awarding agency within 30 days after each quarter.',
                    found: true,
                    sources: [{ documentId, pageNumber: 3, excerpt: 'Quarterly reports must be submitted within 30 days of each quarter.' }],
                }),
            ],
        });

        expect(saved).to.deep.equal([]);

        const allItems = await db.getChecklistItemsForDocument({ documentId, agencyId });
        expect(allItems).to.have.length(1);
        expect(allItems[0].id).to.equal(edited.id);
        expect(allItems[0].description).to.equal(edited.description);
        expect(allItems[0].verification_status).to.equal('verified');
        expect(allItems[0].version).to.equal(edited.version);
    });

    it('keeps a different obligation with a different numeric deadline instead of treating it as a duplicate', async () => {
        await knex('checklist_items').insert({
            document_id: documentId,
            category: 'reporting',
            description: 'Submit a quarterly performance report to the awarding agency within 30 days after the end of each calendar quarter.',
            found: true,
            sources: JSON.stringify([{ documentId, pageNumber: 9, excerpt: 'Quarterly reports are due within 30 days.' }]),
        });

        const saved = await db.addMissingChecklistItems({
            documentId,
            items: [
                buildChecklistItem({
                    category: 'reporting',
                    description: 'Submit an annual performance report to the awarding agency within 90 days after the end of the project period.',
                    found: true,
                    sources: [{ documentId, pageNumber: 9, excerpt: 'An annual report is due within 90 days.' }],
                }),
            ],
        });

        expect(saved).to.have.length(1);
        expect(saved[0].description).to.equal('Submit an annual performance report to the awarding agency within 90 days after the end of the project period.');
    });
});
