const { expect } = require('chai');
const {
    CHECKLIST_CATEGORIES, COMPLETION_STATUSES, createChecklistItem, describesSameObligation,
} = require('../../src/lib/checklistItemSchema');

const baseArgs = {
    documentId: 27,
    grantId: 335255,
    category: 'reporting',
    description: 'Submit quarterly performance reports within 30 days after each quarter.',
    found: true,
    sources: [{ documentId: 27, pageNumber: 14, excerpt: 'Quarterly performance reports are due within 30 days...' }],
};

describe('createChecklistItem', () => {
    it('builds an item carrying every field the Checklist Contract requires', () => {
        const item = createChecklistItem(baseArgs);
        expect(item.documentId).to.equal(27);
        expect(item.grantId).to.equal(335255);
        expect(item.category).to.equal('reporting');
        expect(item.description).to.equal(baseArgs.description);
        expect(item.found).to.equal(true);
        expect(item.sources).to.deep.equal(baseArgs.sources);
        expect(item.possiblyAffectedByQualityIssue).to.equal(false);
        expect(item.dueDate).to.equal(null);
        expect(item.completionStatus).to.equal('notStarted');
        expect(item.userNotes).to.equal(null);
        expect(item.isUserEdited).to.equal(false);
        expect(item.verificationStatus).to.equal('unverified');
        expect(item.verifiedBy).to.equal(null);
        expect(item.verifiedAt).to.equal(null);
    });

    it('accepts a due date and a quality-issue flag', () => {
        const item = createChecklistItem({
            ...baseArgs, dueDate: '2026-12-31', possiblyAffectedByQualityIssue: true,
        });
        expect(item.dueDate).to.equal('2026-12-31');
        expect(item.possiblyAffectedByQualityIssue).to.equal(true);
    });

    it('defaults sources to an empty array when not given', () => {
        const item = createChecklistItem({ ...baseArgs, sources: undefined, found: false });
        expect(item.sources).to.deep.equal([]);
    });

    it('does not share a sources array reference across two items', () => {
        const first = createChecklistItem({ ...baseArgs, sources: undefined });
        const second = createChecklistItem({ ...baseArgs, sources: undefined });
        first.sources.push({ documentId: 27, pageNumber: 1, excerpt: 'x' });
        expect(second.sources).to.deep.equal([]);
    });

    it('rejects a category outside the contract', () => {
        expect(() => createChecklistItem({ ...baseArgs, category: 'invalidCategory' }))
            .to.throw('Unknown checklist item category: invalidCategory');
    });

    CHECKLIST_CATEGORIES.forEach((category) => {
        it(`accepts the allowed category "${category}"`, () => {
            const item = createChecklistItem({ ...baseArgs, category });
            expect(item.category).to.equal(category);
        });
    });
});

describe('COMPLETION_STATUSES', () => {
    it('matches the Checklist Completion States the shared contract defines', () => {
        expect(COMPLETION_STATUSES).to.deep.equal([
            'notStarted', 'inProgress', 'completed', 'notApplicable',
        ]);
    });
});

describe('describesSameObligation', () => {
    it('treats a reworded repeat of the same obligation as the same obligation', () => {
        expect(describesSameObligation(
            'Retain records for three years after closeout.',
            'Records related to this award must be kept for a period of three years following closeout.',
        )).to.equal(true);
    });

    it('treats two different obligations sharing a page and category as different', () => {
        expect(describesSameObligation(
            'Submit the original signed SF-424 application form with an original ink signature.',
            'Include a certificate of insurance covering the full project period.',
        )).to.equal(false);
    });

    it('is not fooled by two different obligations that happen to share a few common words', () => {
        expect(describesSameObligation(
            'Submit a certified audit report within 90 days of the project end date.',
            'Submit a certificate of insurance within 30 days of the award start date.',
        )).to.equal(false);
    });

    it('returns false when either description is empty', () => {
        expect(describesSameObligation('', 'Retain records for three years.')).to.equal(false);
        expect(describesSameObligation('Retain records for three years.', '')).to.equal(false);
        expect(describesSameObligation(null, null)).to.equal(false);
    });
});
