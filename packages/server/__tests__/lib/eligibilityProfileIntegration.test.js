const { expect } = require('chai');
const { validateProfile } = require('../../src/lib/complianceProfile');
const { screenGrantRow } = require('../../src/lib/grantsEligibilityAdapter');

describe('C-04 profile and C-06 eligibility contract integration', () => {
    const body = {
        expectedVersion: 0,
        jurisdiction: {
            type: 'city', name: 'Demo City', stateCode: 'FL', countyName: null,
        },
        population: 42000,
        focusAreas: ['stormwater'],
        staffingCapacity: { level: 'limited', fullTimeEquivalent: 1.5, notes: null },
        matchingFunds: { available: false, maximumAmountCents: null, notes: null },
    };
    const row = {
        grant_id: 900010,
        opportunity_status: 'posted',
        close_date: '2026-11-01',
        eligibility_codes: '02',
        cost_sharing: 'No',
    };
    const options = { asOfDate: '2026-10-08' };

    it('accepts a profile that meets the authorized profile API validation contract', () => {
        expect(validateProfile(body)).to.deep.equal([]);
        const result = screenGrantRow({ ...body, organizationId: 0, version: 1 }, row, options);
        expect(result).to.include({ grantId: 900010, disposition: 'eligible', profileVersion: 1 });
        expect(result.blockers).to.deep.equal([]);
    });

    it('uses updated profile funds rather than an unrelated workflow or AI score', () => {
        const requiredRow = {
            ...row, status: 'inbox', cost_sharing: 'Yes', score: 100,
        };
        const result = screenGrantRow({ ...body, organizationId: 0, version: 2 }, requiredRow, options);
        expect(result.disposition).to.equal('blocked');
        expect(result.blockers.map((blocker) => blocker.code)).to.include('MATCHING_FUNDS_UNAVAILABLE');
        expect(result).to.include({ rank: null, score: null, profileVersion: 2 });
    });

    it('requires review when available matching funds cannot be compared with a stated minimum', () => {
        const profile = { ...body, version: 3, matchingFunds: { available: true, maximumAmountCents: 100000 } };
        expect(validateProfile({ ...body, matchingFunds: profile.matchingFunds })).to.deep.equal([]);
        const result = screenGrantRow(profile, { ...row, cost_sharing: 'Yes' }, options);
        expect(result.disposition).to.equal('reviewRequired');
        expect(result.blockers).to.deep.equal([]);
    });
});
