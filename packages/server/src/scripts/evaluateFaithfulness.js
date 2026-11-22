// A-16: summary/checklist faithfulness eval
// running the real brief pipeline (AN-07 chunking -> AN-10 synthesis) on the 12 fixtures,
// then checking every fact and grading it against the answer key
//
// modes (pick one):
//   (none)            dry run, shows what would be sent + token estimate
//   --self-check      fake perfect ai from the answer key, should score 100%
//   --replay <file>   rescoring saved replies, no ai call
//   --live            real ai calls (coecs or gemini), costs money. saves replies for --replay
// extra:
//   --checklist <file>  also checking saved checklist items: { "documents": [{ "id": "<fixture id>", "items": [...] }] }
//   --out <file>        report path (default evaluation/snapshots/a16-faithfulness-<mode>-<date>.json)
//   --only <id,id>      only these fixture ids
const fs = require('fs');
const path = require('path');
const { chunkPages } = require('../lib/documentChunking');
const { synthesizeGrantBrief } = require('../lib/grantBriefSynthesis');
const {
    checkBrief, checkChecklistItems, compareBriefToGold, listBriefFacts, CHECKS,
} = require('../lib/faithfulness-checks');

const ROOT = path.join(__dirname, '..', '..');
const FIXTURES = path.join(ROOT, 'evaluation', 'faithfulness-fixtures.json');

// targets for a live run, the report marks each pass/review
const TARGETS = {
    supportedFactRate: 0.9,
    inventedFacts: 0,
    unparsedChunks: 0,
    aiErrors: 0,
};

function parseArgs(argv) {
    const args = { mode: 'dry' };
    for (let i = 0; i < argv.length; i += 1) {
        const a = argv[i];
        if (a === '--live') args.mode = 'live';
        else if (a === '--self-check') args.mode = 'selfCheck';
        else if (a === '--replay') { args.mode = 'replay'; args.replay = argv[i += 1]; } else if (a === '--checklist') args.checklist = argv[i += 1];
        else if (a === '--out') args.out = argv[i += 1];
        else if (a === '--only') args.only = argv[i += 1].split(',');
        else throw new Error(`unknown option ${a}`);
    }
    return args;
}

// same cleanup as the synthesizer, for counting skipped replies
function parses(text) {
    const cleaned = String(text || '').trim().replace(/^```(json)?/i, '').replace(/```$/, '')
        .trim();
    try {
        const v = JSON.parse(cleaned);
        return v !== null && typeof v === 'object' && !Array.isArray(v);
    } catch (err) {
        return false;
    }
}

// --- fake perfect ai for --self-check and tests ---

function lineWith(pages, pattern) {
    // eslint-disable-next-line no-restricted-syntax
    for (const p of pages) {
        const line = p.text.split('\n').find((l) => pattern.test(l));
        if (line) return { pageNumber: p.pageNumber, excerpt: line.trim() };
    }
    return null;
}

// answering one chunk like a perfect model: only expected facts, quoting the real line
function oracleReply(doc, chunk) {
    const { gold } = doc;
    const pages = chunk.pages.map((p) => ({ pageNumber: p.pageNumber, text: p.text }));
    const reply = {
        purpose: {
            found: false, value: null, pageNumber: null, excerpt: null,
        },
        eligibility: [],
        fundingRange: {
            found: false, minimumAmountCents: null, maximumAmountCents: null, pageNumber: null, excerpt: null,
        },
        keyDates: [],
        costShare: {
            found: false, required: null, description: null, pageNumber: null, excerpt: null,
        },
        keyRequirements: [],
    };

    const desc = pages.find((p) => p.text.startsWith('Description\n'));
    if (gold.purpose && desc) {
        const first = desc.text.split('\n')[1].split(/(?<=\.)\s/)[0];
        reply.purpose = {
            found: true, value: first, pageNumber: desc.pageNumber, excerpt: first,
        };
    }
    const elig = gold.eligibility && lineWith(pages, /^Eligible Applicants:/);
    if (elig) reply.eligibility.push({ value: elig.excerpt.replace(/^Eligible Applicants:\s*/, ''), ...elig });

    const ceiling = gold.fundingRange && lineWith(pages, /^Award Ceiling:/);
    if (ceiling) {
        const floor = lineWith(pages, /^Award Floor:/);
        const useFloor = gold.fundingRange.minimumAmountCents && floor && floor.pageNumber === ceiling.pageNumber;
        reply.fundingRange = {
            found: true,
            maximumAmountCents: gold.fundingRange.maximumAmountCents,
            minimumAmountCents: useFloor ? gold.fundingRange.minimumAmountCents : null,
            pageNumber: ceiling.pageNumber,
            excerpt: useFloor ? `${ceiling.excerpt} ... ${floor.excerpt}` : ceiling.excerpt,
        };
    }
    const cost = gold.costShare && lineWith(pages, /^Cost Sharing or Matching Requirement:/);
    if (cost) {
        reply.costShare = {
            found: true, required: gold.costShare.required, description: cost.excerpt, ...cost,
        };
    }
    (gold.keyDates || []).forEach((d) => {
        const line = lineWith(pages, /^Close Date for Applications:|Applications are due/);
        if (line) reply.keyDates.push({ label: d.label, date: d.date, ...line });
    });
    return JSON.stringify(reply);
}

// --- running one document ---

async function runDocument(doc, replyFor) {
    const chunks = chunkPages(doc.pages);
    const replies = [];
    let unparsed = 0;
    let aiError = null;
    const usage = { inputTokens: 0, outputTokens: 0 };
    let chunkAt = 0;

    const generateText = async (args) => {
        const chunk = chunks[chunkAt];
        chunkAt += 1;
        let result;
        try {
            result = await replyFor(doc, chunk, args);
        } catch (err) {
            // noting the error here, since the brief code now skips a failed chunk instead of throwing (AN-17)
            if (!aiError) aiError = err.code || err.message;
            throw err;
        }
        replies.push({ chunkIndex: chunk.chunkIndex, text: result.text });
        if (!parses(result.text)) unparsed += 1;
        if (result.usage) {
            usage.inputTokens += result.usage.inputTokens || 0;
            usage.outputTokens += result.usage.outputTokens || 0;
        }
        return result;
    };

    let brief = null;
    try {
        brief = await synthesizeGrantBrief({
            documentId: doc.id, runId: 0, chunks, generateText,
        });
    } catch (err) {
        // still catching anything else the brief code throws
        aiError = aiError || err.code || err.message;
    }

    const problems = brief ? checkBrief(brief, doc.pages) : [];
    const facts = brief ? listBriefFacts(brief) : [];
    const badFacts = new Set(problems.filter((p) => p.index !== undefined && p.field !== 'brief' && p.field !== 'notFoundFields')
        .map((p) => `${p.field}|${p.index}`));
    const grades = brief ? compareBriefToGold(brief, doc.gold) : [];
    return {
        id: doc.id,
        chunks: chunks.length,
        replies,
        unparsed,
        aiError,
        usage,
        facts: facts.length,
        supportedFacts: facts.filter((f) => !badFacts.has(`${f.field}|${f.index}`)).length,
        problems,
        grades,
        brief,
    };
}

function summarize(results) {
    const sum = (k) => results.reduce((n, r) => n + r[k], 0);
    const problemCounts = {};
    results.forEach((r) => r.problems.forEach((p) => { problemCounts[p.code] = (problemCounts[p.code] || 0) + 1; }));
    const outcomes = {};
    const byField = {};
    results.forEach((r) => r.grades.forEach((g) => {
        outcomes[g.outcome] = (outcomes[g.outcome] || 0) + 1;
        byField[g.field] = byField[g.field] || {};
        byField[g.field][g.outcome] = (byField[g.field][g.outcome] || 0) + 1;
    }));
    const facts = sum('facts');
    const supported = sum('supportedFacts');
    const expected = (outcomes.correct || 0) + (outcomes.missed || 0) + (outcomes.wrong || 0);
    return {
        documents: results.length,
        chunks: sum('chunks'),
        unparsedChunks: sum('unparsed'),
        aiErrors: results.filter((r) => r.aiError).length,
        facts,
        supportedFacts: supported,
        supportedFactRate: facts ? supported / facts : null,
        problemCounts,
        answerKey: {
            outcomes,
            byField,
            // recall: facts in the notice the brief got right
            recall: expected ? (outcomes.correct || 0) / expected : null,
            inventedFacts: outcomes.invented || 0,
            wrongValues: outcomes.wrong || 0,
        },
        usage: {
            inputTokens: results.reduce((n, r) => n + r.usage.inputTokens, 0),
            outputTokens: results.reduce((n, r) => n + r.usage.outputTokens, 0),
        },
    };
}

function targetResults(s) {
    return {
        supportedFactRate: s.supportedFactRate !== null && s.supportedFactRate >= TARGETS.supportedFactRate,
        inventedFacts: s.answerKey.inventedFacts <= TARGETS.inventedFacts,
        unparsedChunks: s.unparsedChunks <= TARGETS.unparsedChunks,
        aiErrors: s.aiErrors <= TARGETS.aiErrors,
    };
}

const pct = (x) => (x === null ? 'n/a' : `${(x * 100).toFixed(1)}%`);

function printReport(mode, s, targets, results, checklist) {
    console.log(`\nA-16 faithfulness evaluation (${mode})`);
    console.log('='.repeat(48));
    console.log(`documents ${s.documents} | chunks ${s.chunks} | unreadable ai replies ${s.unparsedChunks} | ai errors ${s.aiErrors}`);
    console.log(`\nfacts in the briefs: ${s.facts}`);
    console.log(`  backed by a real quote on the cited page: ${s.supportedFacts}/${s.facts} (${pct(s.supportedFactRate)})`);
    Object.keys(CHECKS).forEach((code) => {
        if (s.problemCounts[code]) console.log(`  ${code.padEnd(24)} ${String(s.problemCounts[code]).padStart(3)}  ${CHECKS[code]}`);
    });
    console.log('\nagainst the answer key:');
    Object.entries(s.answerKey.byField).forEach(([field, o]) => {
        const parts = ['correct', 'wrong', 'missed', 'invented', 'correctlyEmpty'].filter((k) => o[k]).map((k) => `${k} ${o[k]}`);
        console.log(`  ${field.padEnd(16)} ${parts.join(', ')}`);
    });
    console.log(`  recall ${pct(s.answerKey.recall)} | invented facts ${s.answerKey.inventedFacts} | wrong values ${s.answerKey.wrongValues}`);

    const flagged = results.filter((r) => r.problems.length || r.aiError || r.grades.some((g) => ['invented', 'wrong', 'missed'].includes(g.outcome)));
    if (flagged.length) {
        console.log('\nto review:');
        flagged.forEach((r) => {
            const bad = r.grades.filter((g) => ['invented', 'wrong', 'missed'].includes(g.outcome)).map((g) => `${g.field} ${g.outcome}`);
            const codes = [...new Set(r.problems.map((p) => `${p.field} ${p.code}`))];
            console.log(`  ${r.id}: ${[r.aiError && `ai error ${r.aiError}`, ...codes, ...bad].filter(Boolean).join('; ')}`);
        });
    }
    if (checklist) {
        console.log(`\nchecklist items: ${checklist.items}, with problems: ${checklist.itemsWithProblems}`);
        Object.entries(checklist.problemCounts).forEach(([c, n]) => console.log(`  ${c.padEnd(24)} ${n}`));
    }
    if (s.usage.inputTokens || s.usage.outputTokens) console.log(`\ntokens used: ${s.usage.inputTokens} in, ${s.usage.outputTokens} out`);
    console.log('\ntargets:');
    console.log(`  ${targets.supportedFactRate ? 'PASS  ' : 'REVIEW'} at least ${TARGETS.supportedFactRate * 100}% of facts backed by a real quote`);
    console.log(`  ${targets.inventedFacts ? 'PASS  ' : 'REVIEW'} no invented facts (answer key)`);
    console.log(`  ${targets.unparsedChunks ? 'PASS  ' : 'REVIEW'} every ai reply was readable json`);
    console.log(`  ${targets.aiErrors ? 'PASS  ' : 'REVIEW'} no ai errors`);
    console.log(Object.values(targets).every(Boolean) ? '\nALL TARGETS MET' : '\nSOME TARGETS NEED REVIEW (see above)');
}

function dryRun(docs) {
    let chars = 0;
    let calls = 0;
    console.log('\nA-16 dry run: nothing is sent to an ai.\n');
    docs.forEach((doc) => {
        const chunks = chunkPages(doc.pages);
        const docChars = chunks.reduce((n, c) => n + c.pages.reduce((m, p) => m + p.text.length, 0), 0) + chunks.length * 1500;
        chars += docChars;
        calls += chunks.length;
        console.log(`  ${doc.id.padEnd(26)} ${chunks.length} chunk(s), ~${Math.round(docChars / 4)} input tokens`);
    });
    console.log(`\n${calls} ai calls, ~${Math.round(chars / 4)} input tokens total (about 4 characters per token).`);
    console.log('output is up to 4096 tokens per call on coecs (part of it hidden reasoning).');
    console.log('to run it for real: AI_PROVIDER=coecs yarn eval:faithfulness --live');
}

function checkSavedChecklist(file, docsById) {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const out = { items: 0, itemsWithProblems: 0, problemCounts: {} };
    (saved.documents || []).forEach((d) => {
        const doc = docsById.get(d.id);
        if (!doc) throw new Error(`checklist file names unknown fixture id ${d.id}`);
        const problems = checkChecklistItems(d.items, doc.pages);
        out.items += d.items.length;
        out.itemsWithProblems += new Set(problems.map((p) => p.index)).size;
        problems.forEach((p) => { out.problemCounts[p.code] = (out.problemCounts[p.code] || 0) + 1; });
    });
    return out;
}

function makeReplier(mode, args) {
    if (mode === 'selfCheck') {
        return async (doc, chunk) => ({ text: oracleReply(doc, chunk) });
    }
    if (mode === 'replay') {
        const saved = JSON.parse(fs.readFileSync(args.replay, 'utf8'));
        return async (doc, chunk) => {
            const text = saved.replies[`${doc.id}#${chunk.chunkIndex}`];
            if (text === undefined) throw Object.assign(new Error(`no saved reply for ${doc.id} chunk ${chunk.chunkIndex}`), { code: 'no_saved_reply' });
            return { text };
        };
    }
    // live: same adapter the app uses
    // eslint-disable-next-line global-require
    const { getAiConfig, describeConfig, getAiProvider } = require('../lib/ai-provider');
    const config = getAiConfig();
    if (config.provider === 'mock') throw new Error('--live needs AI_PROVIDER=coecs or gemini (it is mock right now)');
    console.log('live run with', describeConfig(config));
    const provider = getAiProvider();
    return async (doc, chunk, callArgs) => provider.generateText(callArgs);
}

async function evaluate({
    mode, docs, replyFor, checklistFile,
}) {
    const results = [];
    // eslint-disable-next-line no-restricted-syntax
    for (const doc of docs) {
        // one at a time so live runs don't hit the rate limit
        // eslint-disable-next-line no-await-in-loop
        results.push(await runDocument(doc, replyFor));
    }
    const summary = summarize(results);
    const targets = targetResults(summary);
    const checklist = checklistFile ? checkSavedChecklist(checklistFile, new Map(docs.map((d) => [d.id, d]))) : null;
    return {
        mode, results, summary, targets, checklist,
    };
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const fixtures = JSON.parse(fs.readFileSync(FIXTURES, 'utf8'));
    const docs = fixtures.documents.filter((d) => !args.only || args.only.includes(d.id));
    if (args.mode === 'dry') {
        dryRun(docs);
        return;
    }

    const replyFor = makeReplier(args.mode, args);
    const run = await evaluate({
        mode: args.mode, docs, replyFor, checklistFile: args.checklist,
    });
    printReport(args.mode, run.summary, run.targets, run.results, run.checklist);

    const today = new Date().toISOString().slice(0, 10);
    const report = {
        evaluation: 'a16-faithfulness',
        mode: args.mode,
        generatedAt: new Date().toISOString(),
        fixtures: fixtures.version,
        promptVersion: 'grant-brief-v1',
        targets: TARGETS,
        targetResults: run.targets,
        summary: run.summary,
        checklist: run.checklist,
        documents: run.results.map(({ replies, ...r }) => r),
    };
    const out = args.out || path.join(ROOT, 'evaluation', 'snapshots', `a16-faithfulness-${args.mode}-${today}.json`);
    fs.writeFileSync(out, `${JSON.stringify(report, null, 2)}\n`);
    console.log(`\nreport: ${path.relative(ROOT, out)}`);

    // saving every live reply so it can be rescored without paying again
    if (args.mode === 'live') {
        const repliesFile = path.join(ROOT, 'evaluation', 'faithfulness-runs', `live-${today}.json`);
        fs.mkdirSync(path.dirname(repliesFile), { recursive: true });
        const replies = {};
        run.results.forEach((r) => r.replies.forEach((x) => { replies[`${r.id}#${x.chunkIndex}`] = x.text; }));
        fs.writeFileSync(repliesFile, `${JSON.stringify({ recordedAt: new Date().toISOString(), replies }, null, 2)}\n`);
        console.log(`saved ai replies: ${path.relative(ROOT, repliesFile)} (rerun free with --replay)`);
    }
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exit(1);
    });
}

module.exports = {
    evaluate, oracleReply, runDocument, summarize, TARGETS,
};
