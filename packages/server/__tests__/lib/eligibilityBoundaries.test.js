const { expect } = require('chai');
const { screenEligibility } = require('../../src/lib/eligibilityBlockers');
const { screenGrantRow } = require('../../src/lib/grantsEligibilityAdapter');

const profile = () => ({
    version: 4,
    jurisdiction: { type: 'city' },
    matchingFunds: { available: true, maximumAmountCents: 100 },
});
const grant = () => ({
    grantId: 810001,
    opportunityStatus: 'posted',
    closeDate: '2026-10-23',
    eligibilityCodes: ['02'],
    costShareRequired: false,
});
const options = { asOfDate: '2026-10-23' };
const blockerCodes = (result) => result.blockers.map(({ code }) => code);

describe('C-08 eligibility calendar boundaries', () => {
    [
        ['2028-02-28', '2028-02-29', 'eligible'],
        ['2028-02-29', '2028-02-29', 'eligible'],
        ['2028-03-01', '2028-02-29', 'blocked'],
        ['2026-12-31', '2027-01-01', 'eligible'],
        ['2027-01-01', '2027-01-01', 'eligible'],
        ['2027-01-02', '2027-01-01', 'blocked'],
        ['2026-04-30', '2026-05-01', 'eligible'],
        ['2026-05-02', '2026-05-01', 'blocked'],
    ].forEach(([asOfDate, closeDate, disposition]) => {
        it(`${asOfDate} against ${closeDate} is ${disposition}`, () => {
            const result = screenEligibility(profile(), { ...grant(), closeDate }, { asOfDate });
            expect(result.disposition).to.equal(disposition);
            expect(blockerCodes(result)).to.deep.equal(disposition === 'blocked' ? ['DEADLINE_PASSED'] : []);
            expect(result.screenedOn).to.equal(asOfDate);
        });
    });

    ['2026-02-29', '2026-04-31', '2026-13-01', '2026-10-23T00:00:00Z'].forEach((closeDate) => {
        it(`requires review for invalid calendar deadline ${closeDate}`, () => {
            const result = screenEligibility(profile(), { ...grant(), closeDate }, options);
            expect(result.disposition).to.equal('reviewRequired');
            expect(result.blockers).to.deep.equal([]);
            expect(result.uncertainties).to.include('A valid closing date is unavailable; verify the deadline in the notice.');
        });
    });

    it('retains an explicit closed blocker even when the deadline is invalid', () => {
        const result = screenEligibility(profile(), {
            ...grant(), opportunityStatus: 'closed', closeDate: '2026-02-29',
        }, options);
        expect(result.disposition).to.equal('blocked');
        expect(blockerCodes(result)).to.deep.equal(['OPPORTUNITY_CLOSED']);
        expect(result.uncertainties).not.to.be.empty;
    });

    it('rejects invalid screening dates rather than silently choosing a date', () => {
        ['2026-02-29', '2026-04-31', '2026-10-23T00:00:00Z', null].forEach((asOfDate) => {
            expect(() => screenEligibility(profile(), grant(), { asOfDate })).to.throw(TypeError);
        });
    });
});

describe('C-08 matching-fund numeric boundaries', () => {
    [
        [0, 0, 'eligible'], [0, 1, 'blocked'], [100, 99, 'eligible'],
        [100, 100, 'eligible'], [100, 101, 'blocked'],
        [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER, 'eligible'],
    ].forEach(([available, required, disposition]) => {
        it(`${available} available cents against ${required} required cents is ${disposition}`, () => {
            const p = profile();
            p.matchingFunds.maximumAmountCents = available;
            const result = screenEligibility(p, {
                ...grant(), costShareRequired: true, minimumMatchingFundsCents: required,
            }, options);
            expect(result.disposition).to.equal(disposition);
            expect(blockerCodes(result)).to.deep.equal(disposition === 'blocked' ? ['MATCHING_FUNDS_INSUFFICIENT'] : []);
        });
    });

    [-1, 0.5, '100', null, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1].forEach((value) => {
        it(`requires review for an invalid required amount: ${String(value)}`, () => {
            const result = screenEligibility(profile(), {
                ...grant(), costShareRequired: true, minimumMatchingFundsCents: value,
            }, options);
            expect(result.disposition).to.equal('reviewRequired');
            expect(result.blockers).to.deep.equal([]);
        });

        it(`requires review for an invalid available limit: ${String(value)}`, () => {
            const p = profile();
            p.matchingFunds.maximumAmountCents = value;
            const result = screenEligibility(p, {
                ...grant(), costShareRequired: true, minimumMatchingFundsCents: 100,
            }, options);
            expect(result.disposition).to.equal('reviewRequired');
            expect(result.blockers).to.deep.equal([]);
        });
    });
});

describe('C-08 conflicting evidence and blocker precedence', () => {
    it('keeps a hard funds blocker alongside uncertain deadline and applicant evidence', () => {
        const p = profile();
        p.matchingFunds.available = false;
        const result = screenEligibility(p, {
            ...grant(), closeDate: null, eligibilityCodes: ['99'], costShareRequired: true, score: 1,
        }, options);
        expect(result.disposition).to.equal('blocked');
        expect(blockerCodes(result)).to.deep.equal(['MATCHING_FUNDS_UNAVAILABLE']);
        expect(result.uncertainties).to.have.length(2);
        expect(result).to.include({
            rank: null, score: null, model: null, profileVersion: 4,
        });
    });

    it('retains a funds blocker when a date-derived closed status needs review', () => {
        const p = profile();
        p.matchingFunds.available = false;
        const result = screenGrantRow(p, {
            grant_id: 810002,
            opportunity_status: 'closed',
            raw_body_json: {
                opportunity: { milestones: { close: { date: options.asOfDate } } },
                eligible_applicants: [{ code: '02' }],
                cost_sharing_or_matching_requirement: true,
            },
        }, options);
        expect(result.disposition).to.equal('blocked');
        expect(blockerCodes(result)).to.deep.equal(['MATCHING_FUNDS_UNAVAILABLE']);
        expect(result.uncertainties.some((message) => message.includes('date-derived closed status'))).to.equal(true);
    });

    it('does not replace absent source requirements with optimistic legacy row values', () => {
        const result = screenGrantRow(profile(), {
            grant_id: 810003,
            opportunity_status: 'posted',
            close_date: '2026-12-31',
            eligibility_codes: '02',
            cost_sharing: 'No',
            raw_body_json: { opportunity: { milestones: {} }, eligible_applicants: [] },
        }, options);
        expect(result.disposition).to.equal('reviewRequired');
        expect(result.blockers).to.deep.equal([]);
        expect(result.uncertainties).to.have.length(3);
    });

    it('does not allow unrestricted codes to erase an elapsed-deadline blocker', () => {
        const result = screenEligibility(profile(), {
            ...grant(), closeDate: '2026-10-22', eligibilityCodes: ['99'],
        }, options);
        expect(result.disposition).to.equal('blocked');
        expect(blockerCodes(result)).to.deep.equal(['DEADLINE_PASSED']);
        expect(result.uncertainties).not.to.be.empty;
    });
});
