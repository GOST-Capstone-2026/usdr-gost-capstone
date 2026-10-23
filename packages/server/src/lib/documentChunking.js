// F1 — Grant Analysis and Compliance Checklist subsystem (AN-07).
// Splits a document's extracted pages into chunks small enough to hand to the AI extraction step
// (AN-08), while recording which source page(s) each chunk came from. The checklist's source
// citations are keyed by page number (docs/g32-shared-api-contracts.md, Source Traceability
// Contract), so a chunk only needs to remember its page range, nothing else downstream needs to
// know chunks exist.

// Roughly 3 pages per chunk at the ~2,800 char/page median seen on the 107-page HUD notice
// (AN-06), which keeps each request well under a typical model's context limit.
const MAX_CHUNK_CHARS = 8000;

// Finds where to cut a too-long piece of text without slicing a word in half. Falls back to a
// hard cut at maxLen if there is no whitespace to break on (e.g. one giant unbroken token).
function findSplitPoint(text, maxLen) {
    const slice = text.slice(0, maxLen);
    const lastSpace = slice.lastIndexOf(' ');
    return lastSpace > 0 ? lastSpace : maxLen;
}

// Splits one page's text into pieces no longer than maxChunkChars, each still tagged with that
// page's own number, for the (rare) case a single page is bigger than a whole chunk.
function splitOversizedPage(page, maxChunkChars) {
    const pieces = [];
    let remaining = page.text;
    while (remaining.length > 0) {
        const cut = remaining.length > maxChunkChars
            ? findSplitPoint(remaining, maxChunkChars)
            : remaining.length;
        const pieceText = remaining.slice(0, cut).trim();
        if (pieceText.length > 0) {
            pieces.push({ pageNumber: page.pageNumber, text: pieceText });
        }
        remaining = remaining.slice(cut).trim();
    }
    return pieces;
}

/**
 * @param {Array<{pageNumber: number, text: string, charCount: number}>} pages from extractPages()
 * @param {number} [maxChunkChars] override for testing
 * @returns {Array<{chunkIndex: number, startPage: number, endPage: number, charCount: number, text: string}>}
 */
function chunkPages(pages, maxChunkChars = MAX_CHUNK_CHARS) {
    // Normalize first, so an oversized page becomes several same-page pieces before chunking.
    const pieces = pages.flatMap((page) => (
        page.charCount > maxChunkChars ? splitOversizedPage(page, maxChunkChars) : [page]
    ));

    const chunks = [];
    let current = [];
    let currentChars = 0;

    const flush = () => {
        if (current.length === 0) return;
        chunks.push({
            chunkIndex: chunks.length,
            startPage: current[0].pageNumber,
            endPage: current[current.length - 1].pageNumber,
            charCount: currentChars,
            text: current.map((p) => p.text).join('\n\n'),
        });
        current = [];
        currentChars = 0;
    };

    pieces.forEach((piece) => {
        const pieceLength = piece.text.length;
        if (currentChars + pieceLength > maxChunkChars && current.length > 0) {
            flush();
        }
        current.push(piece);
        currentChars += pieceLength;
    });
    flush();

    return chunks;
}

module.exports = { chunkPages, MAX_CHUNK_CHARS };
