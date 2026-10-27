const { expect } = require('chai');
const { screenEligibility } = require('../../src/lib/eligibilityBlockers');
const { fromGrantRow, screenGrantRow } = require('../../src/lib/grantsEligibilityAdapter');

const profile = (type = 'tribalGovernment') => ({
    version: 2,
    jurisdiction: { type, name: 'Test government', stateCode: 'AK' },
    matchingFunds: { available: false, maximumAmountCents: null },
});
const opportunity = (changes = {}) => ({
    grantId: 363856,
    opportunityStatus: 'posted',
    closeDate: '2026-11-30',
    eligibilityCodes: ['00'],
    costShareRequired: false,
    ...changes,
});
const options = { asOfDate: '2026-10-20' };
const blockerCodes = (result) => result.blockers.map(({ code }) => code);

describe('A-11/A-12 tribal applicant regressions', () => {
    [['00'], ['01'], ['02'], ['04'], ['12'], ['00', '01', '02', '04']].forEach((eligibilityCodes) => {
        it(`blocks a tribe when definitive categories exclude tribes: ${eligibilityCodes}`, () => {
            const result = screenEligibility(profile(), opportunity({ eligibilityCodes }), options);
            expect(result.disposition).to.equal('blocked');
            expect(blockerCodes(result)).to.deep.equal(['APPLICANT_TYPE_UNSUPPORTED']);
        });
    });
    [['07'], ['11'], ['07', '11'], ['00', '07'], ['08'], [], ['25'], ['99'], ['00', 'unknown']].forEach((eligibilityCodes) => {
        it(`preserves review for a possibly applicable or ambiguous tribal category: ${eligibilityCodes}`, () => {
            const result = screenEligibility(profile(), opportunity({ eligibilityCodes }), options);
            expect(result.disposition).to.equal('reviewRequired');
            expect(blockerCodes(result)).not.to.include('APPLICANT_TYPE_UNSUPPORTED');
        });
    });
    it('preserves review when additional text could qualify a tribe despite the codes', () => {
        const result = screenEligibility(profile(), opportunity({ additionalEligibilityInformation: 'Tribal partners may apply.' }), options);
        expect(result.disposition).to.equal('reviewRequired');
        expect(result.blockers).to.deep.equal([]);
    });
    it('keeps the applicant and funds blockers independently for the state-only evaluation case', () => {
        const result = screenGrantRow(profile(), {
            grant_id: '363856', opportunity_status: 'posted', close_date: '2026-11-30', eligibility_codes: '00', cost_sharing: 'Yes',
        }, options);
        expect(blockerCodes(result)).to.deep.equal(['APPLICANT_TYPE_UNSUPPORTED', 'MATCHING_FUNDS_UNAVAILABLE']);
        expect(result).to.include({ disposition: 'blocked', rank: null, score: null });
    });
    it('does not treat an unspecified other jurisdiction as a tribe', () => {
        expect(screenEligibility(profile('other'), opportunity(), options).disposition).to.equal('reviewRequired');
    });
});

describe('A-11/A-12 geographic notice review safeguards', () => {
    const row = (description, changes = {}) => ({
        grant_id: '362034',
        opportunity_status: 'posted',
        close_date: '2026-11-30',
        eligibility_codes: '02',
        cost_sharing: 'No',
        description,
        ...changes,
    });
    [
        'Proposed projects must be conducted in Alaska.',
        '<p>Proposed projects <strong>must be conducted</strong> in Alaska.&nbsp;</p>',
        'Private forest land in portions of the Lake Superior Basin of Michigan and Wisconsin.',
        'Geographic eligibility is limited by the notice.',
        'Applicants must be located within the service area.',
        'Services shall be provided in designated counties.',
        'Eligible areas are defined in the full notice.',
        'Funding is limited to Alaska.',
        'Only applicants based in the designated county may apply.',
        'Projects are restricted to approved service areas.',
    ].forEach((description) => {
        it(`requires location review even without Others/Unrestricted: ${description}`, () => {
            const result = screenGrantRow(profile('city'), row(description), options);
            expect(result.disposition).to.equal('reviewRequired');
            expect(result.blockers).to.deep.equal([]);
            expect(result.uncertainties.some((message) => message.includes('geographic'))).to.equal(true);
        });
    });
    it('retains the geographic warning alongside an independent hard blocker', () => {
        const result = screenGrantRow(profile('city'), row('Projects must be conducted in Alaska.', { cost_sharing: 'Yes' }), options);
        expect(result.disposition).to.equal('blocked');
        expect(blockerCodes(result)).to.deep.equal(['MATCHING_FUNDS_UNAVAILABLE']);
        expect(result.uncertainties.some((message) => message.includes('geographic'))).to.equal(true);
    });
    it('does not certify geography just because the profile state matches', () => {
        expect(screenGrantRow(profile('city'), row('Projects must be conducted in Alaska.'), options).disposition).to.equal('reviewRequired');
    });
    it('uses raw source text rather than an innocuous legacy description', () => {
        const normalized = fromGrantRow(row('General program.', {
            raw_body_json: {
                opportunity: { title: 'Marine grants', description: 'Projects must be conducted in Alaska.', milestones: { close: { date: '2026-11-30' } } },
                eligible_applicants: [{ code: '02' }],
                cost_sharing_or_matching_requirement: false,
            },
        }));
        expect(normalized.noticeText).to.include('Projects must be conducted in Alaska.');
        expect(screenEligibility(profile('city'), normalized, options).disposition).to.equal('reviewRequired');
    });
    it('does not use stale legacy text when the raw source explicitly clears it', () => {
        const normalized = fromGrantRow(row('Projects must be conducted in Alaska.', { raw_body_json: { opportunity: { title: '', description: '' } } }));
        expect(normalized.noticeText).to.equal('');
    });
    it('checks additional eligibility text for location limits without inventing exclusions', () => {
        const result = screenEligibility(profile('city'), opportunity({
            eligibilityCodes: ['02'], additionalEligibilityInformation: 'Applicants must be located in the program region.',
        }), options);
        expect(result.disposition).to.equal('reviewRequired');
        expect(result.blockers).to.deep.equal([]);
        expect(result.uncertainties.some((message) => message.includes('geographic'))).to.equal(true);
    });
    it('does not infer geographic limits from an ordinary description', () => {
        expect(screenGrantRow(profile('city'), row('Reduce urban flooding with drainage improvements.'), options).disposition).to.equal('eligible');
    });
});
