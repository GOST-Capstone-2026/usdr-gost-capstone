// A-17: outside service failures and junk ai output
// every outside service is faked, so no network, db or ai calls
//   1. ai provider (coecs) failures
//   2. malformed ai output going into the grant brief, and whether the A-16 checks catch what gets through
//   3. one chunk failing in the middle of a long document
//   3b. bad ai output and chunk failures in the checklist (AN-14)
//   4. storage (s3) and pdf failures during an analysis run
//   5. bad messages from the grants.gov feed
//   (local ranking model is covered by connor's semanticRanking/localSemanticEmbedding tests)
const { expect } = require('chai');
const rewire = require('rewire');
const { createAiProvider, AiProviderError } = require('../../src/lib/ai-provider');
const { synthesizeGrantBrief } = require('../../src/lib/grantBriefSynthesis');
const { generateChecklistItems } = require('../../src/lib/checklistGeneration');
const { checkBrief } = require('../../src/lib/faithfulness-checks');
const { mapSourceDataToGrant, processMessages } = require('../../src/lib/grants-ingest');

const COECS = {
    provider: 'coecs',
    model: 'gpt-5.6-luna',
    apiKey: 'test-key-abcd',
    baseUrl: 'https://coecs.example/v1',
    maxOutputTokens: 4096,
    temperature: null,
    timeoutMs: 50,
    maxRetries: 2,
};

// fake fetch, plays back one response per call and counts calls
function fakeFetch(responses) {
    const calls = [];
    const fn = async (url, opts) => {
        calls.push({ url, opts });
        const next = responses[Math.min(calls.length - 1, responses.length - 1)];
        if (typeof next === 'function') return next(url, opts);
        return {
            status: next.status,
            ok: next.status >= 200 && next.status < 300,
            json: async () => {
                if (next.body === undefined) throw new SyntaxError('Unexpected token < in JSON');
                return next.body;
            },
        };
    };
    fn.calls = calls;
    return fn;
}

const noSleep = async () => {};
const okReply = (content, finishReason = 'stop') => ({
    status: 200,
    body: { model: 'gpt-5.6-luna', choices: [{ message: { content }, finish_reason: finishReason }], usage: {} },
});

async function errorOf(promise) {
    try {
        await promise;
    } catch (err) {
        return err;
    }
    throw new Error('expected it to fail, but it worked');
}

// two-page notice + its chunk, same shape as AN-07
const PAGES = [
    { pageNumber: 1, text: 'Close Date for Applications: Nov 16, 2026\nAward Ceiling: $80,000,000\nCost Sharing or Matching Requirement: Yes' },
    { pageNumber: 2, text: 'Description\nThe purpose of the program is to reduce wildlife-vehicle collisions.' },
];
const CHUNK = {
    chunkIndex: 0, startPage: 1, endPage: 2, pages: PAGES,
};

async function briefFrom(replyText) {
    return synthesizeGrantBrief({
        documentId: 1, runId: 1, chunks: [CHUNK], generateText: async () => ({ text: replyText }),
    });
}

const allNotFound = ['purpose', 'eligibility', 'fundingRange', 'keyDates', 'costShare', 'keyRequirements'];

describe('A-17 failure handling', () => {
    describe('1. ai provider failures (coecs)', () => {
        it('retries a server error twice, then gives up with "unavailable"', async () => {
            const fetchFn = fakeFetch([{ status: 503, body: { error: { message: 'gateway down' } } }]);
            const ai = createAiProvider(COECS, { fetchFn, sleepFn: noSleep });
            const err = await errorOf(ai.generateText({ prompt: 'hi' }));
            expect(err).to.be.instanceOf(AiProviderError);
            expect(err.code).to.equal('unavailable');
            expect(fetchFn.calls).to.have.length(3);
        });

        it('recovers when the service comes back on a retry', async () => {
            const fetchFn = fakeFetch([{ status: 502, body: {} }, okReply('{"ok":true}')]);
            const ai = createAiProvider(COECS, { fetchFn, sleepFn: noSleep });
            const res = await ai.generateText({ prompt: 'hi' });
            expect(res.text).to.equal('{"ok":true}');
            expect(fetchFn.calls).to.have.length(2);
        });

        it('times out a call that hangs instead of waiting forever', async () => {
            const hang = (url, opts) => new Promise((resolve, reject) => {
                opts.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })));
            });
            const fetchFn = fakeFetch([hang]);
            const ai = createAiProvider({ ...COECS, maxRetries: 0 }, { fetchFn, sleepFn: noSleep });
            const err = await errorOf(ai.generateText({ prompt: 'hi' }));
            expect(err.code).to.equal('timeout');
            expect(err.retryable).to.equal(true);
        });

        it('turns a network failure into a retryable "network" error', async () => {
            const down = async () => { throw new TypeError('fetch failed: ECONNREFUSED'); };
            const fetchFn = fakeFetch([down]);
            const ai = createAiProvider(COECS, { fetchFn, sleepFn: noSleep });
            const err = await errorOf(ai.generateText({ prompt: 'hi' }));
            expect(err.code).to.equal('network');
            expect(fetchFn.calls).to.have.length(3);
        });

        it('does not retry a bad or expired key', async () => {
            const fetchFn = fakeFetch([{ status: 401, body: { error: { message: 'invalid api key' } } }]);
            const ai = createAiProvider(COECS, { fetchFn, sleepFn: noSleep });
            const err = await errorOf(ai.generateText({ prompt: 'hi' }));
            expect(err.code).to.equal('auth');
            expect(fetchFn.calls).to.have.length(1);
        });

        it('handles an html error page (not json) with a 200 status as an empty reply', async () => {
            const fetchFn = fakeFetch([{ status: 200 }]);
            const ai = createAiProvider(COECS, { fetchFn, sleepFn: noSleep });
            const err = await errorOf(ai.generateText({ prompt: 'hi' }));
            expect(err.code).to.equal('empty');
        });

        it('flags a reply that was cut off at the token limit', async () => {
            const fetchFn = fakeFetch([okReply('{"purpose": {"found": tr', 'length')]);
            const ai = createAiProvider(COECS, { fetchFn, sleepFn: noSleep });
            const res = await ai.generateText({ prompt: 'hi' });
            expect(res.truncated).to.equal(true);
        });

        it('never puts the api key in an error message', async () => {
            const fetchFn = fakeFetch([{ status: 500, body: { error: { message: 'internal error' } } }]);
            const ai = createAiProvider(COECS, { fetchFn, sleepFn: noSleep });
            const err = await errorOf(ai.generateText({ prompt: 'hi' }));
            expect(`${err.message} ${JSON.stringify(err)}`).to.not.include(COECS.apiKey);
        });
    });

    describe('2. malformed ai output in the grant brief', () => {
        // junk replies: nothing saved, nothing crashes
        const junk = {
            'plain prose': 'Sure! This grant is about wildlife crossings.',
            'a cut-off json reply': '{"purpose": {"found": true, "value": "Reduce colli',
            'a json array': '[1, 2, 3]',
            'the word null': 'null',
            'an empty string': '',
            'json wrapped in a code fence with chatter after it': '```json\n{"purpose":{"found":false}}\n```\nHope this helps!',
            'fields with the wrong types': JSON.stringify({
                purpose: 'reduce collisions', eligibility: { value: 'states' }, keyDates: 'Nov 16', fundingRange: 80000000, costShare: [],
            }),
        };

        Object.entries(junk).forEach(([name, reply]) => {
            it(`ignores ${name} and reports every field as not found`, async () => {
                const brief = await briefFrom(reply);
                expect(brief.notFoundFields).to.deep.equal(allNotFound);
                expect(checkBrief(brief, PAGES)).to.deep.equal([]);
            });
        });

        it('copes with a huge reply without hanging', async () => {
            const huge = JSON.stringify({ keyRequirements: Array.from({ length: 20000 }, () => ({ value: 'x'.repeat(50), pageNumber: 1, excerpt: 'nope' })) });
            const started = Date.now();
            const brief = await briefFrom(huge);
            expect(brief.keyRequirements).to.have.length(20000);
            expect(Date.now() - started).to.be.lessThan(5000);
        });

        // saved as-is today, the A-16 checks catch each one (AN-10 finding, A-17 doc)
        const slipsThrough = [
            ['a found fact with no quote', { purpose: { found: true, value: 'Reduce collisions.' } }, 'FOUND_HAS_SOURCE'],
            ['a page number the document does not have', {
                purpose: {
                    found: true, value: 'Reduce collisions.', pageNumber: 99, excerpt: 'reduce wildlife-vehicle collisions',
                },
            }, 'PAGE_EXISTS'],
            ['a quote that is not in the notice', {
                costShare: {
                    found: true, required: false, description: 'None', pageNumber: 1, excerpt: 'No cost share is required.',
                },
            }, 'EXCERPT_ON_PAGE'],
            ['a date that is not a date', {
                keyDates: [{
                    label: 'close', date: 'mid-November', pageNumber: 1, excerpt: 'Close Date for Applications: Nov 16, 2026',
                }],
            }, 'DATE_VALID'],
            ['an amount written as words', {
                fundingRange: {
                    found: true, maximumAmountCents: '80 million', pageNumber: 1, excerpt: 'Award Ceiling: $80,000,000',
                },
            }, 'AMOUNT_VALID'],
            ['an amount off by 100x (dollars sent as cents)', {
                fundingRange: {
                    found: true, maximumAmountCents: 80000000, pageNumber: 1, excerpt: 'Award Ceiling: $80,000,000',
                },
            }, 'AMOUNT_SUPPORTED'],
        ];

        slipsThrough.forEach(([name, reply, code]) => {
            it(`lets ${name} into the brief, and the A-16 check ${code} catches it`, async () => {
                const brief = await briefFrom(JSON.stringify(reply));
                expect(checkBrief(brief, PAGES).map((p) => p.code)).to.include(code);
            });
        });
    });

    describe('3. one chunk failing in a long document', () => {
        const goodChunk = (i) => ({ ...CHUNK, chunkIndex: i });
        const good = JSON.stringify({
            purpose: {
                found: true, value: 'Reduce collisions.', pageNumber: 2, excerpt: 'reduce wildlife-vehicle collisions',
            },
        });

        it('skips a chunk with a junk reply and keeps the facts from the good chunks', async () => {
            const replies = [good, 'not json', '{}'];
            let i = 0;
            const brief = await synthesizeGrantBrief({
                documentId: 1, runId: 1, chunks: [0, 1, 2].map(goodChunk), generateText: async () => ({ text: replies[i++] }), // eslint-disable-line no-plusplus
            });
            expect(brief.purpose.found).to.equal(true);
        });

        it('loses the whole brief when one chunk\'s ai call errors, even if earlier chunks worked', async () => {
            // current behavior: run completes but GET .../brief is 404 (AN-10 finding, A-17 doc)
            let i = 0;
            const generateText = async () => {
                i += 1;
                if (i === 2) throw new AiProviderError('coecs timed out after 30000ms', { code: 'timeout', retryable: true });
                return { text: good };
            };
            const err = await errorOf(synthesizeGrantBrief({
                documentId: 1, runId: 1, chunks: [0, 1, 2].map(goodChunk), generateText,
            }));
            expect(err.code).to.equal('timeout');
            expect(i).to.equal(2);
        });
    });

    describe('3b. bad ai output and chunk failures in the checklist (AN-14)', () => {
        const goodChunk = (i) => ({ ...CHUNK, chunkIndex: i });
        const realItem = {
            category: 'costShare', description: 'Cost share is required.', dueDate: null, pageNumber: 1, excerpt: 'Cost Sharing or Matching Requirement: Yes',
        };
        const itemsFrom = (replies) => {
            let i = 0;
            return generateChecklistItems({
                documentId: 1, grantId: '1', chunks: replies.map((_, n) => goodChunk(n)), generateText: async () => ({ text: replies[i++] }), // eslint-disable-line no-plusplus
            });
        };

        it('keeps an item whose quote is really on the page', async () => {
            const items = await itemsFrom([JSON.stringify([realItem])]);
            expect(items).to.have.length(1);
        });

        [
            ['a made-up quote', { ...realItem, excerpt: 'Cost share of 50% is required' }],
            ['a fake page number', { ...realItem, pageNumber: 9 }],
            ['no quote at all', { ...realItem, excerpt: '' }],
            ['a category outside the contract', { ...realItem, category: 'budget' }],
        ].forEach(([name, item]) => {
            it(`drops an item with ${name}`, async () => {
                const items = await itemsFrom([JSON.stringify([item])]);
                expect(items).to.have.length(0);
            });
        });

        it('turns a date that isn\'t a real date into no date', async () => {
            const items = await itemsFrom([JSON.stringify([{ ...realItem, dueDate: 'mid-November' }])]);
            expect(items[0].dueDate).to.equal(null);
        });

        it('skips a chunk with a junk reply and keeps the items from the good chunks', async () => {
            const items = await itemsFrom([JSON.stringify([realItem]), 'not json', '{}']);
            expect(items).to.have.length(1);
        });

        it('loses the whole checklist when one chunk\'s ai call errors, even if earlier chunks worked', async () => {
            // current behavior, same as the brief (open item, A-17 doc)
            let i = 0;
            const generateText = async () => {
                i += 1;
                if (i === 2) throw new AiProviderError('coecs timed out after 30000ms', { code: 'timeout', retryable: true });
                return { text: JSON.stringify([realItem]) };
            };
            const err = await errorOf(generateChecklistItems({
                documentId: 1, grantId: '1', chunks: [0, 1, 2].map(goodChunk), generateText,
            }));
            expect(err.code).to.equal('timeout');
        });
    });

    // eslint-disable-next-line func-names
    describe('4. storage and pdf failures during an analysis run', function () {
        // first load of the real module + db code is slow
        this.timeout(15000);

        // real runAnalysis with s3, pdf, ai and db faked
        // checklistError defaults to briefError, since both steps use the same ai provider
        function setup({
            s3Error, pdfError, quality = 'good', briefError, checklistError = briefError,
        } = {}) {
            const mod = rewire('../../src/lib/analysisRuns');
            const calls = {
                started: 0, completed: [], failed: [], briefs: [], checklists: [], aiCalls: 0, errors: [],
            };
            mod.__set__('db', {
                knex: {},
                startAnalysisRun: async () => { calls.started += 1; },
                completeAnalysisRun: async (a) => { calls.completed.push(a); },
                failAnalysisRun: async (a) => { calls.failed.push(a); },
                saveDocumentAnalysisResults: async () => {},
                createGrantBrief: async (a) => { calls.briefs.push(a); },
                getChecklistItemsForDocument: async () => [],
                createInitialChecklistItems: async (a) => { calls.checklists.push(a); },
            });
            mod.__set__('generateChecklistItems', async () => {
                calls.aiCalls += 1;
                if (checklistError) throw checklistError;
                return [{ category: 'reporting', found: true }];
            });
            mod.__set__('getGrantDocumentsS3Client', () => ({
                send: async () => {
                    if (s3Error) throw s3Error;
                    return { Body: [Buffer.from('%PDF-fake')] };
                },
            }));
            mod.__set__('extractPages', async () => {
                if (pdfError) throw pdfError;
                return { pageCount: 2, pages: PAGES };
            });
            mod.__set__('assessExtractionQuality', (pages) => ({ quality, pages }));
            mod.__set__('synthesizeGrantBrief', async () => {
                calls.aiCalls += 1;
                if (briefError) throw briefError;
                return { purpose: { found: true } };
            });
            const quiet = () => {};
            mod.__set__('log', {
                info: quiet, warn: quiet, error: (o) => calls.errors.push(o), debug: quiet,
            });
            const document = {
                id: 7, agency_id: 1, grant_id: '364009', storage_bucket: 'gost-docs', storage_key: 'org-1/doc-7.pdf',
            };
            return { run: () => mod.runAnalysis({ id: 3 }, document, { userId: 1, tenantId: 1 }), calls };
        }

        it('marks the run failed (not stuck "processing") when the stored file is missing', async () => {
            const { run, calls } = setup({ s3Error: Object.assign(new Error('The specified key does not exist.'), { name: 'NoSuchKey' }) });
            await run();
            expect(calls.failed).to.have.length(1);
            expect(calls.completed).to.have.length(0);
            expect(calls.aiCalls).to.equal(0);
        });

        it('marks the run failed when storage is unreachable, and saves the raw error text', async () => {
            // page now shows a friendly message, but the api still sends this raw text as errorMessage (A-17 doc)
            const { run, calls } = setup({ s3Error: new Error('connect ECONNREFUSED 172.18.0.4:4566') });
            await run();
            expect(calls.failed[0].errorMessage).to.equal('connect ECONNREFUSED 172.18.0.4:4566');
        });

        it('marks the run failed when the file is not a readable pdf', async () => {
            const { run, calls } = setup({ pdfError: new Error('Invalid PDF structure.') });
            await run();
            expect(calls.failed).to.have.length(1);
            expect(calls.briefs).to.have.length(0);
        });

        it('skips the ai step for an unreadable scan, so no money is spent on it', async () => {
            const { run, calls } = setup({ quality: 'unreadable' });
            await run();
            expect(calls.aiCalls).to.equal(0);
            expect(calls.completed).to.have.length(1);
        });

        it('still completes the run when the ai step fails, just without a brief', async () => {
            const { run, calls } = setup({ briefError: new AiProviderError('budget used up', { code: 'budget' }) });
            await run();
            expect(calls.completed).to.have.length(1);
            expect(calls.failed).to.have.length(0);
            expect(calls.briefs).to.have.length(0);
            expect(calls.checklists).to.have.length(0);
            expect(calls.errors.some((e) => e.err && e.err.code === 'budget')).to.equal(true);
        });

        it('still completes the run when the ai provider is misconfigured (no key)', async () => {
            const { run, calls } = setup({ briefError: new AiProviderError('AI_PROVIDER=coecs but COECS_API_KEY is not set', { code: 'config' }) });
            await run();
            expect(calls.completed).to.have.length(1);
            expect(calls.briefs).to.have.length(0);
            expect(calls.checklists).to.have.length(0);
        });

        it('keeps the brief when only the checklist step fails', async () => {
            const { run, calls } = setup({ checklistError: new AiProviderError('upstream timeout', { code: 'timeout' }) });
            await run();
            expect(calls.completed).to.have.length(1);
            expect(calls.briefs).to.have.length(1);
            expect(calls.checklists).to.have.length(0);
        });

        it('skips the checklist step for an unreadable scan too', async () => {
            const { run, calls } = setup({ quality: 'unreadable' });
            await run();
            expect(calls.checklists).to.have.length(0);
        });
    });

    describe('5. bad messages from the grants.gov feed', () => {
        const listing = () => ({
            opportunity: {
                id: '1', number: 'N-1', title: 'T', description: 'D', category: { name: 'Discretionary' }, milestones: { post_date: '2026-01-01', close: { date: '2026-12-01' } },
            },
            revision: { id: 'r1' },
            agency: { code: 'A' },
        });

        it('maps a normal listing', () => {
            expect(mapSourceDataToGrant(listing()).grant_id).to.equal('1');
        });

        it('treats a listing with no close date as open-ended (2100-01-01) instead of failing', () => {
            const l = listing();
            delete l.opportunity.milestones.close;
            expect(mapSourceDataToGrant(l).close_date).to.equal('2100-01-01');
        });

        it('throws on a listing missing its milestones or category, so it can be counted as bad', () => {
            const a = listing();
            delete a.opportunity.milestones;
            const b = listing();
            delete b.opportunity.category;
            expect(() => mapSourceDataToGrant(a)).to.throw(TypeError);
            expect(() => mapSourceDataToGrant(b)).to.throw(TypeError);
        });

        // muting noisy ingest logs
        let restore;
        beforeEach(() => {
            const saved = { log: console.log, error: console.error, warn: console.warn };
            console.log = () => {};
            console.error = () => {};
            console.warn = () => {};
            restore = () => Object.assign(console, saved);
        });
        afterEach(() => restore());

        const sqs = () => {
            const sent = [];
            return { sent, send: async (cmd) => { sent.push(cmd); } };
        };
        const event = (source) => ({ Body: JSON.stringify({ detail: { type: 'update', versions: { new: source } } }), ReceiptHandle: 'r' });

        it('skips listings it cannot read and leaves them on the queue, without touching the database', async () => {
            const broken = listing();
            delete broken.opportunity.milestones;
            const q = sqs();
            const knex = () => { throw new Error('database should not be touched'); };
            await processMessages(knex, q, 'queue', [{ Body: 'not json', ReceiptHandle: 'a' }, event(broken)]);
            expect(q.sent).to.have.length(0);
        });

        it('rejects the whole batch when a message has no "detail" (pinned: crashes the importer loop)', async () => {
            // known gap in original GOST code (A-17 doc)
            const q = sqs();
            const err = await errorOf(processMessages(() => {}, q, 'queue', [{ Body: '{}', ReceiptHandle: 'a' }]));
            expect(err).to.be.instanceOf(TypeError);
        });
    });
});
