const path = require('path');
const { expect } = require('chai');
const { getSessionCookie, makeTestServer, knex } = require('./utils');
const db = require('../../src/db');
const { createChecklistItem } = require('../../src/lib/checklistItemSchema');

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

    it('persists created items with storage-assigned audit fields', async () => {
        const items = await db.createChecklistItems({
            documentId,
            items: [
                createChecklistItem({
                    documentId,
                    grantId: '335255',
                    category: 'reporting',
                    description: 'Submit quarterly performance reports within 30 days after each quarter.',
                    found: true,
                    sources: [{ documentId, pageNumber: 14, excerpt: 'Quarterly performance reports are due...' }],
                    dueDate: '2026-12-31',
                }),
                createChecklistItem({
                    documentId,
                    grantId: '335255',
                    category: 'costShare',
                    description: 'Not found in the processed notice.',
                    found: false,
                }),
            ],
        });

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
