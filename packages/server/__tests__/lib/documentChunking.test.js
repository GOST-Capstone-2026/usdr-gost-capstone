const { expect } = require('chai');
const { chunkPages } = require('../../src/lib/documentChunking');

function page(pageNumber, text) {
    return { pageNumber, text, charCount: text.length };
}

describe('chunkPages', () => {
    it('returns no chunks for a document with no pages', () => {
        expect(chunkPages([])).to.deep.equal([]);
    });

    it('puts a short document into a single chunk spanning all its pages', () => {
        const pages = [page(1, 'a'.repeat(100)), page(2, 'b'.repeat(100)), page(3, 'c'.repeat(100))];
        const chunks = chunkPages(pages);
        expect(chunks).to.have.length(1);
        expect(chunks[0]).to.include({ chunkIndex: 0, startPage: 1, endPage: 3, charCount: 300 });
    });

    it('starts a new chunk once the size limit would be exceeded', () => {
        const pages = [page(1, 'a'.repeat(30)), page(2, 'b'.repeat(30)), page(3, 'c'.repeat(30))];
        const chunks = chunkPages(pages, 50);
        expect(chunks).to.have.length(3);
        expect(chunks.map((c) => [c.startPage, c.endPage])).to.deep.equal([[1, 1], [2, 2], [3, 3]]);
    });

    it('keeps chunks in page order with no gaps or overlaps', () => {
        const pages = Array.from({ length: 10 }, (_, i) => page(i + 1, 'x'.repeat(25)));
        const chunks = chunkPages(pages, 60);
        const coveredPages = chunks.flatMap((c) => (
            Array.from({ length: c.endPage - c.startPage + 1 }, (_, i) => c.startPage + i)
        ));
        expect(coveredPages).to.deep.equal(Array.from({ length: 10 }, (_, i) => i + 1));
    });

    it('splits a single page bigger than the chunk limit into same-page pieces', () => {
        const pages = [page(7, 'word '.repeat(26).trim())];
        const chunks = chunkPages(pages, 50);
        expect(chunks.length).to.be.greaterThan(1);
        chunks.forEach((chunk) => {
            expect(chunk.startPage).to.equal(7);
            expect(chunk.endPage).to.equal(7);
            expect(chunk.text.length).to.be.at.most(50);
        });
    });

    it('splits an oversized page at a space instead of cutting a word in half', () => {
        const text = `${'a'.repeat(48)} ${'b'.repeat(48)}`;
        const chunks = chunkPages([page(1, text)], 50);
        expect(chunks.map((c) => c.text)).to.deep.equal(['a'.repeat(48), 'b'.repeat(48)]);
    });
});
