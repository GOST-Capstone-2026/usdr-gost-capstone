const { expect } = require('chai');
const { validateProfile } = require('../../src/lib/complianceProfile');
const { screenGrantRow } = require('../../src/lib/grantsEligibilityAdapter');

const profileBody = () => ({
    expectedVersion: 0,
    jurisdiction: {
        type: 'city', name: 'Test City', stateCode: 'FL', countyName: null,
    },
    population: 42000,
    focusAreas: ['stormwater'],
    staffingCapacity: { level: 'limited', fullTimeEquivalent: 1.5, notes: null },
    matchingFunds: { available: true, maximumAmountCents: 100, notes: null },
});

// Pure contract tests: no API fixtures, database access, or simulated persistence.
describe('T-03 profile input validation boundaries', () => {
    [0, 2147483647].forEach((population) => {
        it(`accepts supported population boundary ${population}`, () => {
            expect(validateProfile({ ...profileBody(), population })).to.deep.equal([]);
        });
    });
    [-1, 0.5, 2147483648, '42000', null].forEach((population) => {
        it(`rejects unsupported population ${String(population)}`, () => {
            expect(validateProfile({ ...profileBody(), population }).map(({ field }) => field)).to.include('population');
        });
    });

    [0, Number.MAX_SAFE_INTEGER].forEach((maximumAmountCents) => {
        it(`accepts exact integer-cent boundary ${maximumAmountCents}`, () => {
            const body = profileBody();
            body.matchingFunds.maximumAmountCents = maximumAmountCents;
            expect(validateProfile(body)).to.deep.equal([]);
        });
    });
    [-1, 0.1, '100', Number.MAX_SAFE_INTEGER + 1].forEach((maximumAmountCents) => {
        it(`rejects unsafe matching-fund limit ${maximumAmountCents}`, () => {
            const body = profileBody();
            body.matchingFunds.maximumAmountCents = maximumAmountCents;
            expect(validateProfile(body).map(({ field }) => field)).to.include('matchingFunds.maximumAmountCents');
        });
    });

    [0, 100000].forEach((fullTimeEquivalent) => {
        it(`accepts supported staffing boundary ${fullTimeEquivalent}`, () => {
            const body = profileBody();
            body.staffingCapacity.fullTimeEquivalent = fullTimeEquivalent;
            expect(validateProfile(body)).to.deep.equal([]);
        });
    });
    [-0.1, 100001, NaN, Infinity, '1.5'].forEach((fullTimeEquivalent) => {
        it(`rejects invalid staffing value ${String(fullTimeEquivalent)}`, () => {
            const body = profileBody();
            body.staffingCapacity.fullTimeEquivalent = fullTimeEquivalent;
            expect(validateProfile(body).map(({ field }) => field)).to.include('staffingCapacity.fullTimeEquivalent');
        });
    });

    it('accepts maximum text/list lengths and rejects the next character or item', () => {
        const body = profileBody();
        body.jurisdiction.name = 'n'.repeat(200);
        body.jurisdiction.countyName = 'c'.repeat(200);
        body.focusAreas = Array(30).fill('f'.repeat(100));
        body.staffingCapacity.notes = 's'.repeat(2000);
        body.matchingFunds.notes = 'm'.repeat(2000);
        expect(validateProfile(body)).to.deep.equal([]);
        body.jurisdiction.name += 'n';
        body.jurisdiction.countyName += 'c';
        body.focusAreas.push('one more');
        body.staffingCapacity.notes += 's';
        body.matchingFunds.notes += 'm';
        expect(validateProfile(body).map(({ field }) => field)).to.include.members([
            'jurisdiction.name', 'jurisdiction.countyName', 'focusAreas', 'staffingCapacity.notes', 'matchingFunds.notes',
        ]);
        expect(validateProfile({ ...profileBody(), focusAreas: ['f'.repeat(101)] }).map(({ field }) => field))
            .to.include('focusAreas');
    });

    it('rejects ownership and version metadata in the client-writable body', () => {
        const body = {
            ...profileBody(), organizationId: 99, tenantId: 88, version: 12, createdBy: 7,
        };
        expect(validateProfile(body).map(({ field }) => field)).to.include.members([
            'organizationId', 'tenantId', 'version', 'createdBy',
        ]);
    });

    [-1, 0.5, '1', null].forEach((expectedVersion) => {
        it(`rejects invalid optimistic-concurrency version ${String(expectedVersion)}`, () => {
            expect(validateProfile({ ...profileBody(), expectedVersion }).map(({ field }) => field)).to.include('expectedVersion');
        });
    });
});

describe('T-03 validated profile-to-blocker regression matrix', () => {
    const row = {
        grant_id: 820001,
        opportunity_status: 'posted',
        close_date: '2026-10-23',
        eligibility_codes: '02',
        cost_sharing: 'No',
    };
    const options = { asOfDate: '2026-10-23' };

    it('changes the applicant result when a valid city profile becomes a county profile', () => {
        const body = profileBody();
        expect(validateProfile(body)).to.deep.equal([]);
        const city = screenGrantRow({ ...body, organizationId: 0, version: 1 }, row, options);
        expect(city).to.include({ disposition: 'eligible', profileVersion: 1 });
        body.jurisdiction.type = 'county';
        body.expectedVersion = 1;
        expect(validateProfile(body)).to.deep.equal([]);
        const county = screenGrantRow({ ...body, organizationId: 0, version: 2 }, row, options);
        expect(county).to.include({ disposition: 'blocked', profileVersion: 2 });
        expect(county.blockers.map(({ code }) => code)).to.deep.equal(['APPLICANT_TYPE_UNSUPPORTED']);
    });

    it('preserves unknown matching requirements after a valid funds update', () => {
        const body = profileBody();
        body.matchingFunds = { available: false, maximumAmountCents: null, notes: null };
        expect(validateProfile(body)).to.deep.equal([]);
        const required = { ...row, cost_sharing: 'Yes' };
        const blocked = screenGrantRow({ ...body, version: 1 }, required, options);
        expect(blocked.blockers.map(({ code }) => code)).to.deep.equal(['MATCHING_FUNDS_UNAVAILABLE']);
        body.matchingFunds = { available: true, maximumAmountCents: 100000, notes: 'Approved locally' };
        body.expectedVersion = 1;
        expect(validateProfile(body)).to.deep.equal([]);
        const reviewed = screenGrantRow({ ...body, version: 2 }, required, options);
        expect(reviewed).to.include({ disposition: 'reviewRequired', profileVersion: 2 });
        expect(reviewed.blockers).to.deep.equal([]);
        expect(reviewed.uncertainties).to.include('The required matching-fund amount is unavailable; verify the amount and permitted contribution types.');
    });

    it('does not mutate a validated profile or stored row while screening repeatedly', () => {
        const body = profileBody();
        expect(validateProfile(body)).to.deep.equal([]);
        const stored = { ...body, organizationId: 0, version: 5 };
        const before = JSON.stringify({ stored, row });
        const first = screenGrantRow(stored, row, options);
        expect(screenGrantRow(stored, row, options)).to.deep.equal(first);
        expect(JSON.stringify({ stored, row })).to.equal(before);
    });
});
