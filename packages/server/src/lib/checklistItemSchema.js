// F1 — Grant Analysis and Compliance Checklist subsystem (AN-11).
// Defines the shape of one checklist item, matching docs/g32-shared-api-contracts.md,
// "Checklist Contract". AN-12 adds the real table and storage functions; AN-14 fills these in
// from the AI adapter's output. This file only defines what one checklist item looks like
// before it is persisted — id, organizationId, version, createdAt, and updatedAt are assigned by
// storage, not here.

// The only categories the Checklist Contract allows for a checklist item.
const CHECKLIST_CATEGORIES = [
    'eligibility', 'applicationMaterial', 'submission', 'costShare',
    'reporting', 'recordRetention', 'deadline', 'other',
];

// Checklist completion status, separate from verificationStatus (see shared contract's "Human
// Verification and Completion States").
const COMPLETION_STATUSES = ['notStarted', 'inProgress', 'completed', 'notApplicable'];

// A person's three possible verdicts on an AI-generated checklist item (AN-15). Rejecting one
// keeps its original generation and revision history rather than deleting it (Checklist Update
// Request contract).
const VERIFICATION_STATUSES = ['unverified', 'verified', 'rejected'];

/**
 * Builds one AI-identified compliance obligation, not yet saved. `found` and `sources` follow
 * the same source traceability contract as grant-brief fields: a claim marked found carries at
 * least one source reference.
 *
 * @param {object} args
 * @param {number} args.documentId
 * @param {number|string} args.grantId
 * @param {string} args.category one of CHECKLIST_CATEGORIES
 * @param {string} args.description
 * @param {boolean} args.found
 * @param {Array<{documentId: number, pageNumber: number, excerpt: string}>} [args.sources]
 * @param {string|null} [args.dueDate] YYYY-MM-DD, or null when no date was found
 * @param {boolean} [args.possiblyAffectedByQualityIssue] true when the source page(s) were
 *   degraded or unreadable, so a person should double-check this item against the original PDF
 * @returns {object} one checklist item, ready for AN-12's storage layer to persist
 */
function createChecklistItem({
    documentId,
    grantId,
    category,
    description,
    found,
    sources = [],
    dueDate = null,
    possiblyAffectedByQualityIssue = false,
}) {
    if (!CHECKLIST_CATEGORIES.includes(category)) {
        throw new Error(`Unknown checklist item category: ${category}`);
    }

    return {
        documentId,
        grantId,
        category,
        description,
        found,
        sources,
        possiblyAffectedByQualityIssue,
        dueDate,
        completionStatus: 'notStarted',
        userNotes: null,
        isUserEdited: false,
        verificationStatus: 'unverified',
        verifiedBy: null,
        verifiedAt: null,
    };
}

// A retry (AN-17 follow-up) can find the same real-world obligation worded slightly differently
// than an earlier run did, since the AI rarely repeats an exact phrasing. These words are common
// enough in grant notices that sharing them says nothing about whether two descriptions name the
// same obligation.
const STOPWORDS = new Set([
    'the', 'and', 'for', 'that', 'with', 'this', 'from', 'must', 'shall', 'will', 'are', 'all',
    'any', 'their', 'each', 'within', 'than', 'then', 'into', 'upon', 'such', 'have', 'has',
]);

function significantWords(text) {
    return new Set(
        String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            // A number is kept regardless of length: two descriptions built from the same
            // boilerplate pattern but a different day count, percentage, or year (a quarterly
            // report due in 30 days vs. an annual report due in 90 days) are different
            // obligations, and the day count is often the only thing that says so.
            .filter((word) => (word.length > 3 && !STOPWORDS.has(word)) || /^\d+$/.test(word)),
    );
}

function distinguishingNumbers(text) {
    return new Set(String(text || '').match(/\d+/g) || []);
}

// Picked empirically: high enough that two distinct obligations sharing a page and category (e.g.
// two different submission requirements cited from the same page) don't share enough meaningful
// words to pass, but low enough that a reworded repeat of the same obligation still does.
const DUPLICATE_WORD_OVERLAP_THRESHOLD = 0.6;

/**
 * True when two checklist item descriptions, or two source excerpts, most likely name or quote
 * the same real-world obligation, judged by how much of their meaningful wording overlaps rather
 * than requiring an exact match. Used to tell a retry's rephrased repeat of an existing item apart
 * from a different obligation that merely shares that item's category and cited page, and to
 * recognize an item by its original source citation even after a person has reworded its
 * description beyond recognition (AN-17 follow-up).
 *
 * @param {string} textA
 * @param {string} textB
 * @returns {boolean}
 */
function describesSameObligation(textA, textB) {
    const numbersA = distinguishingNumbers(textA);
    const numbersB = distinguishingNumbers(textB);
    if (numbersA.size > 0 && numbersB.size > 0 && ![...numbersA].some((number) => numbersB.has(number))) {
        return false;
    }

    const wordsA = significantWords(textA);
    const wordsB = significantWords(textB);
    if (wordsA.size === 0 || wordsB.size === 0) return false;
    const shared = [...wordsA].filter((word) => wordsB.has(word));
    return (shared.length / Math.min(wordsA.size, wordsB.size)) >= DUPLICATE_WORD_OVERLAP_THRESHOLD;
}

module.exports = {
    CHECKLIST_CATEGORIES,
    COMPLETION_STATUSES,
    VERIFICATION_STATUSES,
    createChecklistItem,
    describesSameObligation,
};
