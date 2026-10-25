// Deterministic screening only. A passing screen is not a funding-agency eligibility decision.
const METHOD_VERSION = 'eligibility-v1';
const JURISDICTION_CODES = {
    city: '02', town: '02', village: '02', county: '01', specialDistrict: '04',
};
const KNOWN_CODES = new Set([
    '00', '01', '02', '04', '05', '06', '07', '08', '11', '12', '13', '20', '21', '22', '23', '25', '99',
]);

function isCalendarDate(value) {
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function screenEligibility(profile, opportunity, { asOfDate } = {}) {
    if (!isCalendarDate(asOfDate)) throw new TypeError('asOfDate must be a valid YYYY-MM-DD calendar date.');
    if (!profile || !profile.jurisdiction || !opportunity) {
        throw new TypeError('An organization profile and normalized opportunity are required.');
    }
    const blockers = [];
    const uncertainties = [];
    const block = (code, message, profileField, grantField) => blockers.push({
        code, severity: 'hard', message, profileField, grantField,
    });

    const status = typeof opportunity.opportunityStatus === 'string'
        ? opportunity.opportunityStatus.trim().toLowerCase() : '';
    if (status === 'closed' && opportunity.statusDerivedFromDates === true
        && (!isCalendarDate(opportunity.closeDate) || opportunity.closeDate >= asOfDate)) {
        uncertainties.push('The date-derived closed status conflicts with the inclusive closing date; confirm whether applications are open.');
    } else if (['closed', 'archived'].includes(status)) {
        block('OPPORTUNITY_CLOSED', `The opportunity is ${status}.`, null, 'opportunityStatus');
    } else if (status === 'forecasted') {
        uncertainties.push('The opportunity is forecasted; confirm that applications are open.');
    } else if (status !== 'posted') {
        uncertainties.push('The opportunity status is missing or unsupported; confirm that applications are open.');
    }

    // A date-only close date includes the closing day. An explicit closed status still takes precedence.
    if (!isCalendarDate(opportunity.closeDate)) {
        uncertainties.push('A valid closing date is unavailable; verify the deadline in the notice.');
    } else if (opportunity.closeDate < asOfDate) {
        block('DEADLINE_PASSED', `The closing date ${opportunity.closeDate} is before ${asOfDate}.`, null, 'closeDate');
    }
    if (typeof opportunity.closeDateExplanation === 'string' && opportunity.closeDateExplanation.trim()) {
        uncertainties.push('The closing date has additional instructions; verify the stated time and any exceptions in the notice.');
    }

    const codes = Array.isArray(opportunity.eligibilityCodes)
        ? [...new Set(opportunity.eligibilityCodes.map((code) => String(code).trim()).filter(Boolean))] : [];
    const jurisdiction = profile.jurisdiction.type;
    const jurisdictionCode = JURISDICTION_CODES[jurisdiction];
    const hasAdditionalEligibility = typeof opportunity.additionalEligibilityInformation === 'string'
        && Boolean(opportunity.additionalEligibilityInformation.trim());
    if (!codes.length) {
        uncertainties.push('Applicant eligibility codes are unavailable; review the notice.');
    } else if (codes.includes('25') || codes.includes('99')) {
        uncertainties.push('The applicant categories include Others or Unrestricted; review additional eligibility qualifications in the notice.');
    } else if (codes.some((code) => !KNOWN_CODES.has(code))) {
        uncertainties.push('An applicant eligibility code is unsupported; review the notice before excluding this organization.');
    } else if (!jurisdictionCode) {
        uncertainties.push(jurisdiction === 'tribalGovernment'
            ? 'The profile does not specify tribal recognition; verify the applicable tribal applicant category.'
            : 'This jurisdiction type cannot be mapped to a definite applicant category; review the notice.');
    } else if (!codes.includes(jurisdictionCode) && !hasAdditionalEligibility) {
        block('APPLICANT_TYPE_UNSUPPORTED',
            `The listed applicant categories do not include the profile's ${jurisdiction} government type.`,
            'jurisdiction.type', 'eligibilityCodes');
    }
    if (hasAdditionalEligibility) {
        uncertainties.push('Additional applicant eligibility conditions require review of the notice.');
    }

    if (opportunity.costShareRequired === true) {
        const funds = profile.matchingFunds || {};
        if (funds.available === false) {
            block('MATCHING_FUNDS_UNAVAILABLE', 'The opportunity requires cost sharing, but the profile reports no matching funds available.',
                'matchingFunds.available', 'costShareRequired');
        } else if (funds.available !== true) {
            uncertainties.push('The opportunity requires cost sharing, but the profile does not confirm matching funds availability.');
        } else {
            // This optional internal adapter field must be an explicitly stated minimum, never inferred from an award size.
            const required = opportunity.minimumMatchingFundsCents;
            const available = funds.maximumAmountCents;
            if (!Number.isSafeInteger(required) || required < 0) {
                uncertainties.push('The required matching-fund amount is unavailable; verify the amount and permitted contribution types.');
            } else if (!Number.isSafeInteger(available) || available < 0) {
                uncertainties.push('The available matching-fund limit is unavailable; compare it with the stated requirement.');
            } else if (available < required) {
                block('MATCHING_FUNDS_INSUFFICIENT', 'The stated minimum matching funds exceed the maximum available in the profile.',
                    'matchingFunds.maximumAmountCents', 'minimumMatchingFundsCents');
            }
        }
    } else if (opportunity.costShareRequired !== false) {
        uncertainties.push('The cost-sharing requirement is unknown; verify it in the notice.');
    }

    let disposition = 'eligible';
    if (blockers.length) disposition = 'blocked';
    else if (uncertainties.length) disposition = 'reviewRequired';
    return {
        grantId: opportunity.grantId,
        disposition,
        rank: null,
        score: null,
        scoreFactors: [],
        blockers,
        uncertainties,
        explanation: blockers.length ? 'A deterministic blocker prevents this opportunity from being ranked.'
            : 'No deterministic blocker was found. Review notice-specific conditions before applying.',
        methodVersion: METHOD_VERSION,
        model: null,
        screenedOn: asOfDate,
        profileVersion: profile.version ?? null,
    };
}

module.exports = { screenEligibility, isCalendarDate, METHOD_VERSION };
