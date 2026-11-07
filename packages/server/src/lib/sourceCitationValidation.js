// F1 — Grant Analysis and Compliance Checklist subsystem (AN-13).
// Checks an AI-claimed source citation against a document's real extracted text, implementing
// docs/g32-shared-api-contracts.md's Source Traceability Contract ("Source references use
// one-based page numbers and exact extracted excerpts"). Deliberately generic, not
// checklist-specific: grant-brief facts (AN-09/AN-10) and checklist items (AN-11/AN-12) both cite
// sources in the exact same { documentId, pageNumber, excerpt } shape, so this module works for
// either without caring which one called it.
//
// This module is pure: it takes a document's pages as plain data (the same
// Array<{pageNumber, text}> shape extractPages()/chunkPages() already use) rather than reading
// the database itself, so a caller mid-pipeline can validate against pages already in memory, and
// the module stays trivial to unit test. A caller validating after the fact (e.g. a future
// verification route) is responsible for fetching the real pages first.

// PDF extraction and an AI's restated excerpt can differ in whitespace even when they are the
// same text, so excerpts are compared after collapsing runs of whitespace to a single space.
function normalizeWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * Checks one source reference against a document's real extracted pages.
 *
 * @param {{documentId: number, pageNumber: number, excerpt: string}} source
 * @param {Array<{pageNumber: number, text: string}>} pages the document's real extracted pages
 * @param {{expectedDocumentId?: number}} [options] when given, the source must cite that document
 * @returns {{valid: boolean, reason: string|null}} reason is one of 'wrongDocument',
 *   'pageNotFound', or 'excerptNotFound' when invalid, null when valid
 */
function validateSource(source, pages, { expectedDocumentId } = {}) {
    if (expectedDocumentId !== undefined && source.documentId !== expectedDocumentId) {
        return { valid: false, reason: 'wrongDocument' };
    }

    const page = pages.find((p) => p.pageNumber === source.pageNumber);
    if (!page) {
        return { valid: false, reason: 'pageNotFound' };
    }

    const normalizedPageText = normalizeWhitespace(page.text);
    const normalizedExcerpt = normalizeWhitespace(source.excerpt);
    if (!normalizedExcerpt || !normalizedPageText.includes(normalizedExcerpt)) {
        return { valid: false, reason: 'excerptNotFound' };
    }

    return { valid: true, reason: null };
}

/**
 * Validates every source in a list, in order.
 *
 * @param {Array<{documentId: number, pageNumber: number, excerpt: string}>} sources
 * @param {Array<{pageNumber: number, text: string}>} pages
 * @param {{expectedDocumentId?: number}} [options]
 * @returns {Array<{valid: boolean, reason: string|null}>}
 */
function validateSources(sources, pages, options = {}) {
    return sources.map((source) => validateSource(source, pages, options));
}

/**
 * Implements the Checklist Update Request rule: "Verification requires at least one source when
 * found is true." A found item needs at least one source, and every source it cites must
 * actually check out, not merely be present. An item with found: false has nothing to cite, so
 * it is always eligible.
 *
 * @param {{found: boolean, sources: Array<{documentId: number, pageNumber: number, excerpt: string}>}} item
 * @param {Array<{pageNumber: number, text: string}>} pages
 * @param {{expectedDocumentId?: number}} [options]
 * @returns {boolean}
 */
function canVerifyFoundItem(item, pages, options = {}) {
    if (!item.found) {
        return true;
    }
    if (!item.sources || item.sources.length === 0) {
        return false;
    }
    return validateSources(item.sources, pages, options).every((result) => result.valid);
}

module.exports = { validateSource, validateSources, canVerifyFoundItem };
