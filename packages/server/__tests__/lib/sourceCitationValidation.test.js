const { expect } = require('chai');
const { validateSource, validateSources, canVerifyFoundItem } = require('../../src/lib/sourceCitationValidation');

const PAGES = [
    { pageNumber: 1, text: 'This grant supports eligible local stormwater projects.' },
    { pageNumber: 2, text: 'Quarterly   performance\nreports are due within 30 days after each quarter.' },
];

function source(overrides = {}) {
    return {
        documentId: 27, pageNumber: 2, excerpt: 'Quarterly performance reports are due within 30 days', ...overrides,
    };
}

describe('validateSource', () => {
    it('accepts an excerpt that appears on the cited page', () => {
        expect(validateSource(source(), PAGES)).to.deep.equal({ valid: true, reason: null });
    });

    it('matches across whitespace differences between the excerpt and the real page text', () => {
        const result = validateSource(source({ excerpt: 'Quarterly performance\n   reports are due' }), PAGES);
        expect(result).to.deep.equal({ valid: true, reason: null });
    });

    it('rejects an excerpt that does not appear on the cited page', () => {
        const result = validateSource(source({ excerpt: 'This text was never extracted from any page.' }), PAGES);
        expect(result).to.deep.equal({ valid: false, reason: 'excerptNotFound' });
    });

    it('rejects a page number the document does not have', () => {
        const result = validateSource(source({ pageNumber: 99 }), PAGES);
        expect(result).to.deep.equal({ valid: false, reason: 'pageNotFound' });
    });

    it('rejects an empty excerpt', () => {
        const result = validateSource(source({ excerpt: '   ' }), PAGES);
        expect(result).to.deep.equal({ valid: false, reason: 'excerptNotFound' });
    });

    it('rejects a source citing a different document when expectedDocumentId is given', () => {
        const result = validateSource(source({ documentId: 999 }), PAGES, { expectedDocumentId: 27 });
        expect(result).to.deep.equal({ valid: false, reason: 'wrongDocument' });
    });

    it('does not check documentId when expectedDocumentId is not given', () => {
        const result = validateSource(source({ documentId: 999 }), PAGES);
        expect(result).to.deep.equal({ valid: true, reason: null });
    });
});

describe('validateSources', () => {
    it('validates each source independently, in order', () => {
        const sources = [source(), source({ pageNumber: 99 }), source({ documentId: 1 })];
        const results = validateSources(sources, PAGES, { expectedDocumentId: 27 });
        expect(results).to.deep.equal([
            { valid: true, reason: null },
            { valid: false, reason: 'pageNotFound' },
            { valid: false, reason: 'wrongDocument' },
        ]);
    });

    it('returns an empty array for an empty source list', () => {
        expect(validateSources([], PAGES)).to.deep.equal([]);
    });
});

describe('canVerifyFoundItem', () => {
    it('allows verifying a not-found item even with no sources', () => {
        expect(canVerifyFoundItem({ found: false, sources: [] }, PAGES)).to.equal(true);
    });

    it('allows verifying a found item whose sources all check out', () => {
        const item = { found: true, sources: [source()] };
        expect(canVerifyFoundItem(item, PAGES)).to.equal(true);
    });

    it('blocks verifying a found item with no sources', () => {
        const item = { found: true, sources: [] };
        expect(canVerifyFoundItem(item, PAGES)).to.equal(false);
    });

    it('blocks verifying a found item whose source does not check out', () => {
        const item = { found: true, sources: [source({ pageNumber: 99 })] };
        expect(canVerifyFoundItem(item, PAGES)).to.equal(false);
    });

    it('blocks verifying a found item when only one of several sources is invalid', () => {
        const item = { found: true, sources: [source(), source({ pageNumber: 99 })] };
        expect(canVerifyFoundItem(item, PAGES)).to.equal(false);
    });
});
