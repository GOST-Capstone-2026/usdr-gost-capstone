const { expect } = require('chai');
const {
    BRIEF_FIELD_NAMES, createEmptyBrief, computeNotFoundFields,
} = require('../../src/lib/grantBriefSchema');

describe('createEmptyBrief', () => {
    it('reports every field as not found', () => {
        const brief = createEmptyBrief({ documentId: 27, runId: 81 });
        expect(brief.documentId).to.equal(27);
        expect(brief.runId).to.equal(81);
        expect(brief.purpose).to.deep.equal({ found: false, value: null, sources: [] });
        expect(brief.eligibility).to.deep.equal([]);
        expect(brief.fundingRange).to.deep.equal({
            found: false, minimumAmountCents: null, maximumAmountCents: null, currency: 'USD', sources: [],
        });
        expect(brief.keyDates).to.deep.equal([]);
        expect(brief.costShare).to.deep.equal({
            found: false, required: null, description: 'Not found in the processed notice.', sources: [],
        });
        expect(brief.keyRequirements).to.deep.equal([]);
        expect(brief.verificationStatus).to.equal('unverified');
        expect(brief.generatedAt).to.equal(null);
    });

    it('lists every field in notFoundFields', () => {
        const brief = createEmptyBrief({ documentId: 27, runId: 81 });
        expect(brief.notFoundFields).to.deep.equal(BRIEF_FIELD_NAMES);
    });

    it('does not share array or object references across two briefs', () => {
        const first = createEmptyBrief({ documentId: 1, runId: 1 });
        const second = createEmptyBrief({ documentId: 2, runId: 2 });
        first.eligibility.push({ found: true, value: 'Must be a city or county', sources: [] });
        expect(second.eligibility).to.deep.equal([]);
    });
});

describe('computeNotFoundFields', () => {
    it('returns every field name for a brand new brief', () => {
        const brief = createEmptyBrief({ documentId: 27, runId: 81 });
        expect(computeNotFoundFields(brief)).to.deep.equal(BRIEF_FIELD_NAMES);
    });

    it('drops a single-fact field once it is found', () => {
        const brief = createEmptyBrief({ documentId: 27, runId: 81 });
        brief.purpose = {
            found: true,
            value: 'Supports eligible local stormwater projects.',
            sources: [{ documentId: 27, pageNumber: 6, excerpt: 'The program supports...' }],
        };
        expect(computeNotFoundFields(brief)).to.not.include('purpose');
        expect(computeNotFoundFields(brief)).to.have.length(BRIEF_FIELD_NAMES.length - 1);
    });

    it('drops a list field once it has at least one entry', () => {
        const brief = createEmptyBrief({ documentId: 27, runId: 81 });
        brief.keyDates = [{
            found: true, label: 'Application deadline', date: '2026-12-31', sources: [],
        }];
        expect(computeNotFoundFields(brief)).to.not.include('keyDates');
    });

    it('keeps a field in the list when nothing was found for it', () => {
        const brief = createEmptyBrief({ documentId: 27, runId: 81 });
        brief.purpose = {
            found: true, value: 'Supports eligible local stormwater projects.', sources: [],
        };
        expect(computeNotFoundFields(brief)).to.include('eligibility');
        expect(computeNotFoundFields(brief)).to.include('fundingRange');
    });
});
