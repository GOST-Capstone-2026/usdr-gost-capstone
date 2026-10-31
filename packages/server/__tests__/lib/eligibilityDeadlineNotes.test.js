const { expect } = require('chai');
const { screenEligibility } = require('../../src/lib/eligibilityBlockers');
const { screenGrantRow } = require('../../src/lib/grantsEligibilityAdapter');

const profile = {
    version: 1,
    jurisdiction: { type: 'city' },
    matchingFunds: { available: false, maximumAmountCents: null },
};
const opportunity = {
    grantId: 364009,
    opportunityStatus: 'posted',
    closeDate: '2026-12-01',
    eligibilityCodes: ['02'],
    costShareRequired: false,
};
const options = { asOfDate: '2026-10-27' };
const deadlineWarning = 'The closing date has additional instructions; verify the stated time and any exceptions in the notice.';

describe('C-06 deadline-note placeholder regression', () => {
    [undefined, null, '', '   ', 'No Explanation', 'no explanation', 'NO EXPLANATION', ' \tNo Explanation\n '].forEach((closeDateExplanation) => {
        it(`does not invent deadline instructions for ${JSON.stringify(closeDateExplanation)}`, () => {
            const result = screenEligibility(profile, { ...opportunity, closeDateExplanation }, options);
            expect(result.disposition).to.equal('eligible');
            expect(result.blockers).to.deep.equal([]);
            expect(result.uncertainties).to.deep.equal([]);
        });
    });

    ['Due by 5 PM Eastern.', 'No Explanation: see the full notice for exceptions.', 'No Explanation.'].forEach((closeDateExplanation) => {
        it(`preserves review of actual text: ${closeDateExplanation}`, () => {
            const result = screenEligibility(profile, { ...opportunity, closeDateExplanation }, options);
            expect(result.disposition).to.equal('reviewRequired');
            expect(result.uncertainties).to.include(deadlineWarning);
        });
    });

    it('still requires review when the closing date is missing', () => {
        const result = screenEligibility(profile, {
            ...opportunity, closeDate: null, closeDateExplanation: 'No Explanation',
        }, options);
        expect(result.disposition).to.equal('reviewRequired');
        expect(result.uncertainties).to.deep.equal(['A valid closing date is unavailable; verify the deadline in the notice.']);
    });

    it('retains independent applicant, deadline, and matching-fund blockers', () => {
        const result = screenEligibility(profile, {
            ...opportunity, closeDate: '2026-10-26', eligibilityCodes: ['00'], costShareRequired: true, closeDateExplanation: 'No Explanation',
        }, options);
        expect(result.disposition).to.equal('blocked');
        expect(result.blockers.map(({ code }) => code)).to.have.members([
            'DEADLINE_PASSED', 'APPLICANT_TYPE_UNSUPPORTED', 'MATCHING_FUNDS_UNAVAILABLE',
        ]);
        expect(result.uncertainties).not.to.include(deadlineWarning);
    });

    [false, true].forEach((withRawSource) => {
        it(`handles the placeholder through the ${withRawSource ? 'raw-source' : 'legacy-row'} grant adapter`, () => {
            const row = {
                grant_id: '364009',
                opportunity_status: 'posted',
                close_date: '2026-12-01',
                eligibility_codes: '02',
                cost_sharing: 'No',
                close_date_explanation: 'No Explanation',
            };
            if (withRawSource) {
                row.raw_body_json = {
                    opportunity: { milestones: { close: { date: '2026-12-01', explanation: ' No Explanation ' } } },
                    eligible_applicants: [{ code: '02' }],
                    cost_sharing_or_matching_requirement: false,
                };
            }
            const before = JSON.stringify(row);
            const result = screenGrantRow(profile, row, options);
            expect(result.disposition).to.equal('eligible');
            expect(result.uncertainties).to.deep.equal([]);
            expect(JSON.stringify(row)).to.equal(before);
        });
    });
});
