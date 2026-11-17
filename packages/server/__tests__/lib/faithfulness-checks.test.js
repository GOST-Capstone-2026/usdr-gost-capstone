// A-16: clean + tampered case for each check, so each one can actually fail
const { expect } = require('chai');
const fixtures = require('../../evaluation/faithfulness-fixtures.json');
const {
    amountsInText, checkBrief, checkChecklistItems, compareBriefToGold, dateInText, excerptOnPage, isCalendarDate,
} = require('../../src/lib/faithfulness-checks');
const { evaluate, oracleReply, runDocument } = require('../../src/scripts/evaluateFaithfulness');

const doc = fixtures.documents.find((d) => d.id === 'listing-364009');
const hud = fixtures.documents.find((d) => d.id === 'hud-pro-housing-sample');
const oracle = async (d, chunk) => ({ text: oracleReply(d, chunk) });
const codes = (problems) => [...new Set(problems.map((p) => p.code))].sort();

// fresh brief per test so tampering doesn't leak between tests
async function perfectBrief(d = doc) {
    const { brief } = await runDocument(d, oracle);
    return brief;
}

describe('A-16 faithfulness checks', () => {
    describe('helpers', () => {
        it('finds an excerpt on the page even with different spacing, case and curly quotes', () => {
            const page = 'Others (see text field entitled "Additional Information on Eligibility")';
            expect(excerptOnPage('others  (see text field entitled “Additional Information on Eligibility”)', page)).to.equal(true);
        });

        it('allows "..." to skip text, but only in the right order', () => {
            const page = 'Award Ceiling: $80,000,000\nAward Floor: $0';
            expect(excerptOnPage('Award Ceiling: $80,000,000 ... Award Floor: $0', page)).to.equal(true);
            expect(excerptOnPage('Award Floor: $0 ... Award Ceiling: $80,000,000', page)).to.equal(false);
        });

        it('rejects a paraphrase', () => {
            expect(excerptOnPage('The ceiling is eighty million dollars', 'Award Ceiling: $80,000,000')).to.equal(false);
        });

        it('knows real calendar dates', () => {
            expect(isCalendarDate('2026-11-16')).to.equal(true);
            expect(isCalendarDate('2026-02-30')).to.equal(false);
            expect(isCalendarDate('next Friday')).to.equal(false);
            expect(isCalendarDate(20261116)).to.equal(false);
        });

        it('recognizes the usual ways a notice writes a date', () => {
            ['Nov 16, 2026', 'November 16th, 2026', '11/16/2026', '2026-11-16', 'Nov. 16, 2026'].forEach((t) => {
                expect(dateInText('2026-11-16', `Close Date: ${t}`), t).to.equal(true);
            });
            expect(dateInText('2026-11-17', 'Close Date: Nov 16, 2026')).to.equal(false);
        });

        it('reads dollar amounts written different ways, in cents', () => {
            expect(amountsInText('Award Ceiling: $80,000,000')).to.include(8000000000);
            expect(amountsInText('approximately $80 million in funding')).to.include(8000000000);
            expect(amountsInText('up to $1.5M per award')).to.include(150000000);
            expect(amountsInText('roughly 80 miles')).to.not.include(8000000000);
        });
    });

    describe('checkBrief', () => {
        it('passes a brief where every fact quotes its page', async () => {
            expect(checkBrief(await perfectBrief(), doc.pages)).to.deep.equal([]);
        });

        it('FOUND_HAS_SOURCE: a found fact with no quote', async () => {
            const brief = await perfectBrief();
            brief.purpose.sources = [];
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['FOUND_HAS_SOURCE']);
        });

        it('NOT_FOUND_IS_EMPTY: "not found" but still carrying an answer', async () => {
            const brief = await perfectBrief();
            brief.costShare = {
                found: false, required: true, description: 'Not found in the processed notice.', sources: [],
            };
            brief.notFoundFields = [...brief.notFoundFields, 'costShare'];
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['NOT_FOUND_IS_EMPTY']);
        });

        it('PAGE_EXISTS: citing a page the document does not have', async () => {
            const brief = await perfectBrief();
            brief.purpose.sources[0].pageNumber = 9;
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['PAGE_EXISTS']);
        });

        it('EXCERPT_ON_PAGE: a quote the model made up', async () => {
            const brief = await perfectBrief();
            brief.eligibility[0].sources[0].excerpt = 'All nonprofits are eligible.';
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['EXCERPT_ON_PAGE']);
        });

        it('EXCERPT_ON_PAGE: a real quote, but from a different page than it cites', async () => {
            const brief = await perfectBrief();
            brief.purpose.sources[0].pageNumber = 1;
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['EXCERPT_ON_PAGE']);
        });

        it('DATE_VALID: a date that is not a real calendar date', async () => {
            const brief = await perfectBrief();
            brief.keyDates[0].date = 'November 16';
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['DATE_VALID']);
        });

        it('DATE_SUPPORTED: a date that does not match its quote', async () => {
            const brief = await perfectBrief();
            brief.keyDates[0].date = '2026-11-17';
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['DATE_SUPPORTED']);
        });

        it('AMOUNT_VALID: negative, fractional, or min above max', async () => {
            const brief = await perfectBrief();
            brief.fundingRange.minimumAmountCents = -5;
            expect(codes(checkBrief(brief, doc.pages))).to.include('AMOUNT_VALID');
            brief.fundingRange.minimumAmountCents = 9000000000;
            expect(codes(checkBrief(brief, doc.pages))).to.include('AMOUNT_VALID');
            brief.fundingRange.minimumAmountCents = 10.5;
            expect(codes(checkBrief(brief, doc.pages))).to.include('AMOUNT_VALID');
        });

        it('AMOUNT_SUPPORTED: an amount off by 10x from its quote', async () => {
            const brief = await perfectBrief();
            brief.fundingRange.maximumAmountCents = 800000000;
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['AMOUNT_SUPPORTED']);
        });

        it('NOT_FOUND_LIST_MATCHES: notFoundFields out of sync with the fields', async () => {
            const brief = await perfectBrief();
            brief.notFoundFields = ['purpose'];
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['NOT_FOUND_LIST_MATCHES']);
        });

        it('MARKED_UNVERIFIED: a generated brief calling itself verified', async () => {
            const brief = await perfectBrief();
            brief.verificationStatus = 'verified';
            expect(codes(checkBrief(brief, doc.pages))).to.deep.equal(['MARKED_UNVERIFIED']);
        });
    });

    describe('checkChecklistItems', () => {
        const goodItem = () => ({
            category: 'deadline',
            description: 'Submit the application by the close date.',
            found: true,
            sources: [{ documentId: 1, pageNumber: 1, excerpt: 'Close Date for Applications: Nov 16, 2026' }],
            dueDate: '2026-11-16',
            verificationStatus: 'unverified',
            verifiedBy: null,
        });

        it('passes a clean item', () => {
            expect(checkChecklistItems([goodItem()], doc.pages)).to.deep.equal([]);
        });

        it('CATEGORY_VALID: a category outside the contract', () => {
            expect(codes(checkChecklistItems([{ ...goodItem(), category: 'paperwork' }], doc.pages))).to.deep.equal(['CATEGORY_VALID']);
        });

        it('DATE_SUPPORTED: a due date its quote does not say', () => {
            expect(codes(checkChecklistItems([{ ...goodItem(), dueDate: '2026-12-01' }], doc.pages))).to.deep.equal(['DATE_SUPPORTED']);
        });

        it('EXCERPT_ON_PAGE: a quote that is not on the page', () => {
            const item = goodItem();
            item.sources[0].excerpt = 'Quarterly reports are due within 30 days.';
            item.dueDate = null;
            expect(codes(checkChecklistItems([item], doc.pages))).to.deep.equal(['EXCERPT_ON_PAGE']);
        });

        it('MARKED_UNVERIFIED: "verified" with no record of who verified it', () => {
            expect(codes(checkChecklistItems([{ ...goodItem(), verificationStatus: 'verified' }], doc.pages))).to.deep.equal(['MARKED_UNVERIFIED']);
            expect(checkChecklistItems([{ ...goodItem(), verificationStatus: 'verified', verifiedBy: 3 }], doc.pages)).to.deep.equal([]);
        });
    });

    describe('compareBriefToGold', () => {
        it('scores a perfect brief as all correct', async () => {
            const outcomes = compareBriefToGold(await perfectBrief(), doc.gold).map((g) => g.outcome);
            expect(outcomes.every((o) => o === 'correct')).to.equal(true);
        });

        it('calls out a cost-share rule the trap document never states', async () => {
            const brief = await perfectBrief(hud);
            brief.costShare = {
                found: true, required: true, description: 'Cost Sharing or Matching', sources: [{ documentId: 1, pageNumber: 2, excerpt: 'C. Cost Sharing or Matching' }],
            };
            const cost = compareBriefToGold(brief, hud.gold).find((g) => g.field === 'costShare');
            expect(cost.outcome).to.equal('invented');
        });

        it('separates wrong values, missed dates and invented dates', async () => {
            const brief = await perfectBrief();
            brief.fundingRange.maximumAmountCents = 1;
            brief.keyDates = [{
                found: true, label: 'kickoff', date: '2026-10-01', sources: [],
            }];
            const out = compareBriefToGold(brief, doc.gold);
            expect(out.find((g) => g.field === 'fundingRange').outcome).to.equal('wrong');
            expect(out.filter((g) => g.field === 'keyDates').map((g) => g.outcome).sort()).to.deep.equal(['invented', 'missed']);
        });

        it('does not count a real date from the notice (like the posted date) as invented', async () => {
            const brief = await perfectBrief();
            brief.keyDates.push({
                found: true, label: 'posted', date: '2026-09-30', sources: [],
            });
            expect(compareBriefToGold(brief, doc.gold).filter((g) => g.outcome === 'invented')).to.deep.equal([]);
        });
    });

    describe('evaluate (the A-16 script)', () => {
        it('scores the fake perfect ai at 100% on all 12 documents', async () => {
            const run = await evaluate({ mode: 'selfCheck', docs: fixtures.documents, replyFor: oracle });
            expect(run.summary.documents).to.equal(12);
            expect(run.summary.supportedFactRate).to.equal(1);
            expect(run.summary.answerKey.recall).to.equal(1);
            expect(Object.values(run.targets).every(Boolean)).to.equal(true);
        });

        it('flags an ai that pads the brief with made-up facts', async () => {
            const liar = async (d, chunk) => {
                const reply = JSON.parse(oracleReply(d, chunk));
                reply.costShare = {
                    found: true, required: false, description: 'No match needed', pageNumber: 1, excerpt: 'No cost share is required.',
                };
                reply.keyDates.push({
                    label: 'webinar', date: '2026-10-15', pageNumber: 1, excerpt: 'Informational webinar on October 15, 2026',
                });
                return { text: JSON.stringify(reply) };
            };
            const run = await evaluate({ mode: 'test', docs: [doc, hud], replyFor: liar });
            expect(run.summary.problemCounts.EXCERPT_ON_PAGE).to.be.greaterThan(0);
            expect(run.summary.answerKey.inventedFacts).to.be.greaterThan(0);
            expect(run.targets.supportedFactRate).to.equal(false);
            expect(run.targets.inventedFacts).to.equal(false);
        });

        it('counts unreadable replies and ai errors instead of crashing', async () => {
            const prose = async () => ({ text: 'Sure! Here is a summary of the grant.' });
            const broken = async () => { throw Object.assign(new Error('timed out'), { code: 'timeout' }); };
            const a = await evaluate({ mode: 'test', docs: [doc], replyFor: prose });
            const b = await evaluate({ mode: 'test', docs: [doc], replyFor: broken });
            expect(a.summary.unparsedChunks).to.equal(1);
            expect(b.summary.aiErrors).to.equal(1);
            expect(b.results[0].aiError).to.equal('timeout');
        });
    });
});
