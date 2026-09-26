// F1 — Grant Analysis and Compliance Checklist subsystem (pipeline step 7: Extract).
// Reads a PDF buffer and returns its text one page at a time so later checklist items
// can cite an exact page (Source Traceability Contract in docs/g32-shared-api-contracts.md).
const pdfParse = require('pdf-parse');

// Same line-joining approach as pdf-parse's default renderer: items on the same baseline
// (transform[5] is the y position) stay on one line, a new y position starts a new line.
function joinTextItems(items) {
    let lastY;
    let text = '';
    items.forEach((item) => {
        const y = item.transform[5];
        text += (lastY === undefined || lastY === y) ? item.str : `\n${item.str}`;
        lastY = y;
    });
    return text.split('\n').map((line) => line.trim()).filter(Boolean).join('\n');
}

/**
 * @param {Buffer} buffer raw PDF bytes
 * @returns {Promise<{pageCount: number, pages: Array<{pageNumber: number, text: string, charCount: number}>}>}
 *   pageNumber is one-based so it matches the page number a person sees in the PDF.
 */
async function extractPages(buffer) {
    const pages = [];
    const result = await pdfParse(buffer, {
        pagerender: async (pageData) => {
            const content = await pageData.getTextContent({ normalizeWhitespace: true });
            const text = joinTextItems(content.items);
            pages.push({ pageNumber: pageData.pageIndex + 1, text, charCount: text.trim().length });
            return text;
        },
    });

    pages.sort((a, b) => a.pageNumber - b.pageNumber);
    return { pageCount: result.numpages, pages };
}

module.exports = { extractPages };
