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

module.exports = { CHECKLIST_CATEGORIES, COMPLETION_STATUSES, createChecklistItem };
