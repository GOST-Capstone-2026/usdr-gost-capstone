const { expect } = require('chai');
const { screenEligibility } = require('../../src/lib/eligibilityBlockers');

const AS_OF = { asOfDate: '2026-10-04' };
const profile = () => ({
    version: 2,
    jurisdiction: { type: 'city' },
    matchingFunds: { available: true, maximumAmountCents: 250000 },
});
const grant = () => ({
    grantId: 123,
    opportunityStatus: 'posted',
    closeDate: '2026-10-10',
    eligibilityCodes: ['02'],
    costShareRequired: false,
});
const screen = (changes = {}, p = profile()) => screenEligibility(p, { ...grant(), ...changes }, AS_OF);
const codes = (result) => result.blockers.map((blocker) => blocker.code);

describe('deterministic eligibility screening', () => {
    it('passes a posted, current opportunity for a supported applicant without requiring AI', () => {
        const result = screen();
        expect(result.disposition).to.equal('eligible');
        expect(result.blockers).to.deep.equal([]);
        expect(result.uncertainties).to.deep.equal([]);
        expect(result).to.include({
            methodVersion: 'eligibility-v1', profileVersion: 2, model: null, score: null, rank: null,
        });
    });

    ['closed', 'archived'].forEach((opportunityStatus) => {
        it(`blocks an explicitly ${opportunityStatus} opportunity`, () => {
            expect(codes(screen({ opportunityStatus }))).to.include('OPPORTUNITY_CLOSED');
        });
    });

    it('blocks yesterday but includes the closing calendar day', () => {
        expect(codes(screen({ closeDate: '2026-10-03' }))).to.include('DEADLINE_PASSED');
        expect(screen({ closeDate: '2026-10-04' }).disposition).to.equal('eligible');
    });

    it('honors explicit closed status even on the closing day', () => {
        const result = screen({ opportunityStatus: 'closed', closeDate: '2026-10-04' });
        expect(codes(result)).to.deep.equal(['OPPORTUNITY_CLOSED']);
    });

    it('flags deadline instructions rather than assuming date-only eligibility is sufficient', () => {
        expect(screen({ closeDateExplanation: 'Applications must arrive by noon.' }).disposition).to.equal('reviewRequired');
    });

    [null, '', '2026-02-30', '2026-10-04T12:00:00Z'].forEach((closeDate) => {
        it(`requires review for a missing or invalid calendar deadline (${closeDate})`, () => {
            const result = screen({ closeDate });
            expect(result.disposition).to.equal('reviewRequired');
            expect(codes(result)).not.to.include('DEADLINE_PASSED');
        });
    });

    it('requires review for forecasted and unknown status', () => {
        expect(screen({ opportunityStatus: 'forecasted' }).disposition).to.equal('reviewRequired');
        expect(screen({ opportunityStatus: undefined }).disposition).to.equal('reviewRequired');
    });

    it('blocks a city when the definitive applicant list only allows counties', () => {
        const result = screen({ eligibilityCodes: ['01'] });
        expect(result.disposition).to.equal('blocked');
        expect(result.blockers[0]).to.include({
            code: 'APPLICANT_TYPE_UNSUPPORTED', severity: 'hard', profileField: 'jurisdiction.type', grantField: 'eligibilityCodes',
        });
    });

    [{ type: 'county', code: '01' }, { type: 'town', code: '02' }, { type: 'village', code: '02' },
        { type: 'specialDistrict', code: '04' }].forEach(({ type, code }) => {
        it(`maps ${type} to the appropriate applicant category`, () => {
            const p = profile();
            p.jurisdiction.type = type;
            expect(screen({ eligibilityCodes: [code] }, p).disposition).to.equal('eligible');
        });
    });

    [[], ['25'], ['99'], ['01', 'unrecognized']].forEach((eligibilityCodes) => {
        it(`does not invent an applicant exclusion from an ambiguous list (${eligibilityCodes})`, () => {
            const result = screen({ eligibilityCodes });
            expect(result.disposition).to.equal('reviewRequired');
            expect(codes(result)).not.to.include('APPLICANT_TYPE_UNSUPPORTED');
        });
    });

    it('requires notice review even if a listed code matches when additional conditions exist', () => {
        expect(screen({ additionalEligibilityInformation: 'Only cities meeting specific program conditions.' }).disposition)
            .to.equal('reviewRequired');
    });

    it('requires review instead of excluding a potentially qualified applicant named in additional text', () => {
        const result = screen({ eligibilityCodes: ['12'], additionalEligibilityInformation: 'City partners may also apply.' });
        expect(result.disposition).to.equal('reviewRequired');
        expect(result.blockers).to.deep.equal([]);
    });

    ['tribalGovernment', 'other'].forEach((type) => {
        it(`requires review when the profile cannot establish the exact ${type} applicant category`, () => {
            const p = profile();
            p.jurisdiction.type = type;
            expect(screen({ eligibilityCodes: ['07'] }, p).disposition).to.equal('reviewRequired');
        });
    });

    it('blocks a stated cost-share requirement when no matching funds are available', () => {
        const p = profile();
        p.matchingFunds.available = false;
        expect(codes(screen({ costShareRequired: true }, p))).to.include('MATCHING_FUNDS_UNAVAILABLE');
        expect(screen({ costShareRequired: false }, p).disposition).to.equal('eligible');
    });

    it('checks an explicitly stated dollar minimum without guessing from award amounts', () => {
        expect(codes(screen({ costShareRequired: true, minimumMatchingFundsCents: 250001 })))
            .to.include('MATCHING_FUNDS_INSUFFICIENT');
        expect(screen({ costShareRequired: true, minimumMatchingFundsCents: 250000 }).disposition).to.equal('eligible');
        expect(screen({ costShareRequired: true, minimumMatchingFundsCents: 0 }).disposition).to.equal('eligible');
        expect(screen({ costShareRequired: true, awardFloorCents: 1000000 }).disposition).to.equal('reviewRequired');
    });

    it('requires review for unknown fund availability, limits, and cost-share requirements', () => {
        const p = profile();
        p.matchingFunds = { available: true, maximumAmountCents: null };
        expect(screen({ costShareRequired: true, minimumMatchingFundsCents: 100 }, p).disposition).to.equal('reviewRequired');
        p.matchingFunds = {};
        expect(screen({ costShareRequired: true }, p).disposition).to.equal('reviewRequired');
        expect(screen({ costShareRequired: null }).disposition).to.equal('reviewRequired');
    });

    it('keeps every hard blocker visible and ignores any supplied semantic score', () => {
        const p = profile();
        p.matchingFunds.available = false;
        const result = screen({
            opportunityStatus: 'closed', closeDate: '2026-10-03', eligibilityCodes: ['12'], costShareRequired: true, score: 1,
        }, p);
        expect(result.disposition).to.equal('blocked');
        expect(codes(result)).to.deep.equal([
            'OPPORTUNITY_CLOSED', 'DEADLINE_PASSED', 'APPLICANT_TYPE_UNSUPPORTED', 'MATCHING_FUNDS_UNAVAILABLE',
        ]);
        expect(result.rank).to.equal(null);
        expect(result.score).to.equal(null);
    });

    it('does not mutate input records and produces repeatable output', () => {
        const p = profile();
        const g = grant();
        const snapshot = JSON.stringify({ p, g });
        expect(screenEligibility(p, g, AS_OF)).to.deep.equal(screenEligibility(p, g, AS_OF));
        expect(JSON.stringify({ p, g })).to.equal(snapshot);
    });

    it('requires a valid explicit screening date and usable input objects', () => {
        expect(() => screenEligibility(profile(), grant())).to.throw(TypeError);
        expect(() => screenEligibility(profile(), grant(), { asOfDate: '2026-02-30' })).to.throw(TypeError);
        expect(() => screenEligibility(null, grant(), AS_OF)).to.throw(TypeError);
    });
});
