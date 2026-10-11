const { expect } = require('chai');
const { fromGrantRow, screenGrantRow } = require('../../src/lib/grantsEligibilityAdapter');

describe('stored GOST grant eligibility adapter', () => {
    it('maps legacy row names and de-duplicates codes without using workflow status', () => {
        const normalized = fromGrantRow({
            grant_id: 123,
            opportunity_status: 'posted',
            status: 'inbox',
            close_date: '2026-10-10',
            eligibility_codes: '01 02 02',
            cost_sharing: 'Yes',
            award_floor: 1000,
        });
        expect(normalized).to.include({ grantId: 123, opportunityStatus: 'posted', costShareRequired: true });
        expect(normalized.eligibilityCodes).to.deep.equal(['01', '02']);
        expect(normalized.minimumMatchingFundsCents).to.equal(null);
    });

    it('supports normalized code rows while preserving leading zeroes', () => {
        expect(fromGrantRow({ eligibility_codes: [{ code: '02' }, { code: '01' }, { code: '02' }] }).eligibilityCodes)
            .to.deep.equal(['02', '01']);
    });

    it('uses the source payload to distinguish absent requirements from legacy default values', () => {
        const normalized = fromGrantRow({
            close_date: '2100-01-01',
            cost_sharing: 'No',
            eligibility_codes: '02',
            raw_body_json: { opportunity: { milestones: {} } },
        });
        expect(normalized.closeDate).to.equal(null);
        expect(normalized.costShareRequired).to.equal(null);
    });

    it('does not certify the legacy sentinel date even without a raw payload', () => {
        expect(fromGrantRow({ close_date: '2100-01-01' }).closeDate).to.equal(null);
    });

    it('uses explicit source values and preserves additional deadline instructions', () => {
        const normalized = fromGrantRow({
            close_date: '2100-01-01',
            cost_sharing: 'No',
            eligibility_codes: '12',
            raw_body_json: {
                opportunity: { milestones: { close: { date: '2026-10-10', explanation: 'Due by noon ET.' } } },
                cost_sharing_or_matching_requirement: true,
                eligible_applicants: [{ code: '02' }],
                additional_information_on_eligibility: 'Additional program limits apply.',
            },
        });
        expect(normalized).to.include({ closeDate: '2026-10-10', closeDateExplanation: 'Due by noon ET.', costShareRequired: true });
        expect(normalized.eligibilityCodes).to.deep.equal(['02']);
        expect(normalized.additionalEligibilityInformation).to.equal('Additional program limits apply.');
    });

    it('does not treat unrecognized cost-sharing text as a false requirement', () => {
        expect(fromGrantRow({ cost_sharing: 'unknown' }).costShareRequired).to.equal(null);
        expect(fromGrantRow({ cost_sharing: 'No' }).costShareRequired).to.equal(false);
    });

    it('connects an actual GOST row shape to the screening service', () => {
        const result = screenGrantRow({ jurisdiction: { type: 'city' }, matchingFunds: { available: false } }, {
            grant_id: 123,
            opportunity_status: 'posted',
            close_date: '2026-10-10',
            eligibility_codes: '02',
            cost_sharing: 'Yes',
        }, { asOfDate: '2026-10-04' });
        expect(result.disposition).to.equal('blocked');
        expect(result.blockers[0].code).to.equal('MATCHING_FUNDS_UNAVAILABLE');
    });

    it('requires review for legacy ingestion marking a grant closed on its closing day', () => {
        const result = screenGrantRow({ jurisdiction: { type: 'city' }, matchingFunds: { available: false } }, {
            grant_id: 123,
            opportunity_status: 'closed',
            raw_body_json: {
                opportunity: { milestones: { close: { date: '2026-10-04' } } },
                eligible_applicants: [{ code: '02' }],
                cost_sharing_or_matching_requirement: false,
            },
        }, { asOfDate: '2026-10-04' });
        expect(result.disposition).to.equal('reviewRequired');
        expect(result.blockers).to.deep.equal([]);
    });

    it('still blocks a genuinely elapsed close date in a date-derived record', () => {
        const result = screenGrantRow({ jurisdiction: { type: 'city' }, matchingFunds: { available: false } }, {
            grant_id: 123,
            opportunity_status: 'closed',
            raw_body_json: {
                opportunity: { milestones: { close: { date: '2026-10-03' } } },
                eligible_applicants: [{ code: '02' }],
                cost_sharing_or_matching_requirement: false,
            },
        }, { asOfDate: '2026-10-04' });
        expect(result.disposition).to.equal('blocked');
        expect(result.blockers.map((blocker) => blocker.code)).to.include('DEADLINE_PASSED');
    });
});
