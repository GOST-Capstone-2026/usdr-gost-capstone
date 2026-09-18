const JURISDICTION_TYPES = new Set([
    'city', 'county', 'town', 'village', 'tribalGovernment', 'specialDistrict', 'other',
]);
const STAFFING_LEVELS = new Set(['limited', 'moderate', 'substantial']);

function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validateProfile(body) {
    const details = [];
    const issue = (field, message) => details.push({ field, issue: message });
    const allowed = new Set([
        'expectedVersion', 'jurisdiction', 'population', 'focusAreas', 'staffingCapacity', 'matchingFunds',
    ]);
    if (!plainObject(body)) return [{ field: 'body', issue: 'must be a JSON object' }];
    Object.keys(body).forEach((field) => {
        if (!allowed.has(field)) issue(field, 'is not allowed');
    });
    if (!Number.isSafeInteger(body.expectedVersion) || body.expectedVersion < 0) {
        issue('expectedVersion', 'must be a nonnegative integer; use 0 to create');
    }
    if (!plainObject(body.jurisdiction)) {
        issue('jurisdiction', 'must be an object');
    } else {
        const { jurisdiction } = body;
        Object.keys(jurisdiction).forEach((field) => {
            if (!['type', 'name', 'stateCode', 'countyName'].includes(field)) issue(`jurisdiction.${field}`, 'is not allowed');
        });
        if (!JURISDICTION_TYPES.has(jurisdiction.type)) issue('jurisdiction.type', 'is not a supported type');
        if (typeof jurisdiction.name !== 'string' || !jurisdiction.name.trim() || jurisdiction.name.length > 200) {
            issue('jurisdiction.name', 'must be a nonempty name of at most 200 characters');
        }
        if (typeof jurisdiction.stateCode !== 'string' || !/^[A-Z]{2}$/.test(jurisdiction.stateCode)) {
            issue('jurisdiction.stateCode', 'must be a two-letter uppercase state code');
        }
        if (jurisdiction.countyName !== undefined && jurisdiction.countyName !== null
            && (typeof jurisdiction.countyName !== 'string' || jurisdiction.countyName.length > 200)) {
            issue('jurisdiction.countyName', 'must be null or a name of at most 200 characters');
        }
    }
    if (!Number.isSafeInteger(body.population) || body.population < 0 || body.population > 2147483647) {
        issue('population', 'must be a nonnegative integer within the supported range');
    }
    if (!Array.isArray(body.focusAreas) || body.focusAreas.length > 30
        || body.focusAreas.some((area) => typeof area !== 'string' || !area.trim() || area.length > 100)) {
        issue('focusAreas', 'must be an array of at most 30 nonempty strings of at most 100 characters');
    }
    if (!plainObject(body.staffingCapacity)) {
        issue('staffingCapacity', 'must be an object');
    } else {
        const { staffingCapacity } = body;
        Object.keys(staffingCapacity).forEach((field) => {
            if (!['level', 'fullTimeEquivalent', 'notes'].includes(field)) issue(`staffingCapacity.${field}`, 'is not allowed');
        });
        if (!STAFFING_LEVELS.has(staffingCapacity.level)) issue('staffingCapacity.level', 'is not a supported level');
        if (typeof staffingCapacity.fullTimeEquivalent !== 'number'
            || !Number.isFinite(staffingCapacity.fullTimeEquivalent)
            || staffingCapacity.fullTimeEquivalent < 0 || staffingCapacity.fullTimeEquivalent > 100000) {
            issue('staffingCapacity.fullTimeEquivalent', 'must be a nonnegative number within the supported range');
        }
        if (staffingCapacity.notes !== undefined && staffingCapacity.notes !== null
            && (typeof staffingCapacity.notes !== 'string' || staffingCapacity.notes.length > 2000)) {
            issue('staffingCapacity.notes', 'must be null or a string of at most 2000 characters');
        }
    }
    if (!plainObject(body.matchingFunds)) {
        issue('matchingFunds', 'must be an object');
    } else {
        const { matchingFunds } = body;
        Object.keys(matchingFunds).forEach((field) => {
            if (!['available', 'maximumAmountCents', 'notes'].includes(field)) issue(`matchingFunds.${field}`, 'is not allowed');
        });
        if (typeof matchingFunds.available !== 'boolean') issue('matchingFunds.available', 'must be a boolean');
        if (matchingFunds.maximumAmountCents !== null && matchingFunds.maximumAmountCents !== undefined
            && (!Number.isSafeInteger(matchingFunds.maximumAmountCents) || matchingFunds.maximumAmountCents < 0)) {
            issue('matchingFunds.maximumAmountCents', 'must be null or a nonnegative integer');
        }
        if (matchingFunds.notes !== undefined && matchingFunds.notes !== null
            && (typeof matchingFunds.notes !== 'string' || matchingFunds.notes.length > 2000)) {
            issue('matchingFunds.notes', 'must be null or a string of at most 2000 characters');
        }
    }
    return details;
}

module.exports = { validateProfile };
