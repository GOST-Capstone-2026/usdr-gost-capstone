// F1 — Grant Analysis and Compliance Checklist subsystem (AN-06).
// Decides which pages of an uploaded PDF look scanned or unreadable, and rates the whole document,
// so the checklist can later tell "we could not read this page" apart from "this is not in the document".

// A page with fewer trimmed characters than this is treated as having no real text layer (a scan or
// an image-only page). Measured on the 107-page HUD notice: the thinnest real page has 227
// characters and the median page has about 2,800, so 50 flags scans without flagging real pages.
const MIN_PAGE_CHARS = 50;

// Share of low-text pages at which a document is rated degraded or unreadable.
const DEGRADED_RATIO = 0.1;
const UNREADABLE_RATIO = 0.9;

/**
 * @param {Array<{pageNumber: number, text: string, charCount: number}>} pages from extractPages()
 * @returns {{quality: 'readable'|'degraded'|'unreadable', lowTextPages: number[],
 *            pages: Array<{pageNumber: number, text: string, charCount: number, isLowText: boolean}>}}
 */
function assessExtractionQuality(pages) {
    const assessed = pages.map((page) => ({ ...page, isLowText: page.charCount < MIN_PAGE_CHARS }));
    const lowTextPages = assessed.filter((page) => page.isLowText).map((page) => page.pageNumber);

    const ratio = assessed.length === 0 ? 1 : lowTextPages.length / assessed.length;
    let quality = 'readable';
    if (ratio >= UNREADABLE_RATIO) {
        quality = 'unreadable';
    } else if (ratio >= DEGRADED_RATIO) {
        quality = 'degraded';
    }

    return { quality, lowTextPages, pages: assessed };
}

module.exports = {
    assessExtractionQuality,
    MIN_PAGE_CHARS,
    DEGRADED_RATIO,
    UNREADABLE_RATIO,
};
