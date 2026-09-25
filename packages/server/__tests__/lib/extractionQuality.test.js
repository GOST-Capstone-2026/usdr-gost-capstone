const { expect } = require('chai');
const {
    assessExtractionQuality,
    MIN_PAGE_CHARS,
} = require('../../src/lib/extractionQuality');

function page(pageNumber, charCount) {
    return { pageNumber, text: 'x'.repeat(charCount), charCount };
}

function pagesWithLowText(total, lowCount) {
    return Array.from({ length: total }, (_, i) => page(i + 1, i < lowCount ? 0 : 2000));
}

describe('assessExtractionQuality', () => {
    it('rates a document with real text on every page as readable', () => {
        const result = assessExtractionQuality(pagesWithLowText(20, 0));
        expect(result.quality).to.equal('readable');
        expect(result.lowTextPages).to.deep.equal([]);
    });

    it('does not flag a short cover page that still has real text', () => {
        const result = assessExtractionQuality([page(1, 227), page(2, 2800), page(3, 2400)]);
        expect(result.quality).to.equal('readable');
        expect(result.pages[0].isLowText).to.equal(false);
    });

    it('treats a page as low text only when it is under the minimum', () => {
        const result = assessExtractionQuality([page(1, MIN_PAGE_CHARS - 1), page(2, MIN_PAGE_CHARS)]);
        expect(result.pages.map((p) => p.isLowText)).to.deep.equal([true, false]);
    });

    it('tolerates one blank divider page out of many', () => {
        expect(assessExtractionQuality(pagesWithLowText(20, 1)).quality).to.equal('readable');
    });

    it('rates a document with some scanned pages as degraded and lists them', () => {
        const result = assessExtractionQuality(pagesWithLowText(10, 3));
        expect(result.quality).to.equal('degraded');
        expect(result.lowTextPages).to.deep.equal([1, 2, 3]);
    });

    it('rates a fully scanned document as unreadable', () => {
        expect(assessExtractionQuality(pagesWithLowText(10, 10)).quality).to.equal('unreadable');
    });

    it('rates a document with no pages as unreadable', () => {
        const result = assessExtractionQuality([]);
        expect(result.quality).to.equal('unreadable');
        expect(result.pages).to.deep.equal([]);
    });

    it('keeps the original page fields and adds isLowText', () => {
        const [first] = assessExtractionQuality([page(7, 300)]).pages;
        expect(first).to.include({ pageNumber: 7, charCount: 300, isLowText: false });
        expect(first.text).to.have.length(300);
    });
});
