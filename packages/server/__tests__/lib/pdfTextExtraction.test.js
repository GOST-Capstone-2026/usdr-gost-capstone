const fs = require('fs');
const path = require('path');
const { expect } = require('chai');
const { extractPages } = require('../../src/lib/pdfTextExtraction');

describe('PDF text extraction', () => {
    it('reads a compressed page from a buffer with a nonzero offset', async () => {
        const pdf = fs.readFileSync(path.join(__dirname, '../fixtures/compressed-reporting-notice.pdf'));
        const prefix = Buffer.from('prefix');
        const bytes = Buffer.concat([prefix, pdf]).subarray(prefix.length);
        const result = await extractPages(bytes);

        expect(result.pageCount).to.equal(1);
        expect(result.pages).to.have.length(1);
        expect(result.pages[0].pageNumber).to.equal(1);
        expect(result.pages[0].text).to.include('Submit the quarterly financial report by November 23, 2026.');
    });
});
