const { screenEligibility } = require('./eligibilityBlockers');

function codeList(value) {
    let values = [];
    if (Array.isArray(value)) values = value;
    else if (typeof value === 'string') values = value.split(/[\s,|]+/);
    return [...new Set(values.map((item) => {
        const code = item && typeof item === 'object' ? item.code : item;
        return code == null ? '' : String(code).trim();
    }).filter(Boolean))];
}

function fromGrantRow(row) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) throw new TypeError('A stored GOST grant row is required.');
    const raw = row.raw_body_json && typeof row.raw_body_json === 'object' ? row.raw_body_json : null;
    const close = raw?.opportunity?.milestones?.close;
    let closeDate = row.close_date === '2100-01-01' ? null : row.close_date;
    if (raw) closeDate = close?.date || null;
    let costShareRequired = null;
    if (raw) {
        if (typeof raw.cost_sharing_or_matching_requirement === 'boolean') {
            costShareRequired = raw.cost_sharing_or_matching_requirement;
        }
    } else if (typeof row.cost_sharing === 'string') {
        const value = row.cost_sharing.trim().toLowerCase();
        if (value === 'yes') costShareRequired = true;
        else if (value === 'no') costShareRequired = false;
    }
    return {
        grantId: row.grant_id,
        // Do not use the unrelated collaboration/workflow status (such as inbox).
        opportunityStatus: row.opportunity_status,
        statusDerivedFromDates: Boolean(raw?.opportunity?.milestones),
        // Legacy ingestion substitutes 2100-01-01 for an absent deadline. Never certify that placeholder.
        closeDate,
        closeDateExplanation: close?.explanation ?? row.close_date_explanation ?? null,
        eligibilityCodes: codeList(raw?.eligible_applicants ?? row.eligibility_codes),
        additionalEligibilityInformation: raw?.additional_information_on_eligibility
            ?? raw?.eligibility_description ?? null,
        costShareRequired,
        // No minimum is guessed from cost_sharing, award_floor, or award_ceiling.
        minimumMatchingFundsCents: null,
    };
}

function screenGrantRow(profile, row, options) {
    return screenEligibility(profile, fromGrantRow(row), options);
}

module.exports = { fromGrantRow, screenGrantRow };
