// F1 — Grant Analysis and Compliance Checklist subsystem (AN-09).
// Defines the shape of a grant brief: the one-screen summary of a notice's purpose,
// eligibility, funding, dates, cost share, and key requirements, matching
// docs/g32-shared-api-contracts.md, "Grant Brief Contract". AN-10 fills these fields in from the
// AI adapter's output; this file only defines what a brief looks like, filled in or not.

// Every fact-bearing field on a brief, in the order the contract lists them.
const BRIEF_FIELD_NAMES = ['purpose', 'eligibility', 'fundingRange', 'keyDates', 'costShare', 'keyRequirements'];

// One sourced fact: purpose, a single eligibility rule, a single key date, or a single key
// requirement all share this shape. `value` is the AI's plain-language answer, and `sources`
// is one or more page citations backing it up (docs/g32-shared-api-contracts.md, Source
// Traceability Contract).
function emptySourcedField() {
    return {
        found: false, value: null, sources: [],
    };
}

function emptyFundingRange() {
    return {
        found: false, minimumAmountCents: null, maximumAmountCents: null, currency: 'USD', sources: [],
    };
}

function emptyCostShare() {
    return {
        found: false, required: null, description: 'Not found in the processed notice.', sources: [],
    };
}

/**
 * A brand new, empty brief: every field reports "not found," matching the contract's own
 * example response. AN-10 starts from this and replaces fields as the AI finds them.
 *
 * @param {{documentId: number, runId: number}} ids
 */
function createEmptyBrief({ documentId, runId }) {
    return {
        documentId,
        runId,
        purpose: emptySourcedField(),
        eligibility: [],
        fundingRange: emptyFundingRange(),
        keyDates: [],
        costShare: emptyCostShare(),
        keyRequirements: [],
        notFoundFields: [...BRIEF_FIELD_NAMES],
        verificationStatus: 'unverified',
        model: null,
        promptVersion: 'grant-brief-v1',
        generatedAt: null,
    };
}

/**
 * Looks at a brief's fields and returns the names of the ones still not found, the same list
 * that belongs in the brief's notFoundFields.
 *
 * @param {object} brief a brief shaped like createEmptyBrief()'s return value
 * @returns {string[]}
 */
function computeNotFoundFields(brief) {
    return BRIEF_FIELD_NAMES.filter((name) => {
        const field = brief[name];
        if (Array.isArray(field)) {
            return field.length === 0;
        }
        return field.found === false;
    });
}

module.exports = {
    BRIEF_FIELD_NAMES,
    createEmptyBrief,
    computeNotFoundFields,
};
