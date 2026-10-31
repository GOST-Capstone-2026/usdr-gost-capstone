#!/usr/bin/env node
// A-14: running the whole matching process on the merged code and saving the results.
// listing -> ingest -> eligibility (C-06) -> ranking (C-09) -> explanations (C-10), scored with the A-12 metrics.
// it runs twice to make sure the results come out the same. no db, no network, no paid api.
// usage: yarn eval:snapshot                       (prints a summary, saves evaluation/snapshots/a14-integrated-<date>.json)
//        yarn eval:snapshot --out some/file.json  (saving somewhere else)
const fs = require('fs');
const path = require('path');
const fixtures = require('../../evaluation/matching-fixtures.json');
const demoData = require('../../seeds/demo/opportunities.json');
const manifest = require('../lib/semanticModelManifest.json');
const { runEvaluation } = require('./evaluateMatching');
const { METHOD_VERSION: SCREENING_VERSION } = require('../lib/eligibilityBlockers');
const { checkExplanation, CHECKS } = require('../lib/explanation-checks');

const SERVER_ROOT = path.join(__dirname, '..', '..');
const REPO_ROOT = path.join(SERVER_ROOT, '..', '..');

// reading the commit straight from .git, since the container has no git binary
function gitInfo() {
    try {
        const gitDir = path.join(REPO_ROOT, '.git');
        const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
        if (!head.startsWith('ref: ')) return { branch: null, head };
        const ref = head.slice(5);
        const loose = path.join(gitDir, ref);
        if (fs.existsSync(loose)) return { branch: ref.replace('refs/heads/', ''), head: fs.readFileSync(loose, 'utf8').trim() };
        const packed = fs.readFileSync(path.join(gitDir, 'packed-refs'), 'utf8').split('\n').find((line) => line.endsWith(` ${ref}`));
        return { branch: ref.replace('refs/heads/', ''), head: packed ? packed.split(' ')[0] : null };
    } catch (err) {
        return { branch: null, head: null };
    }
}

// one full pass: the A-12 evaluation, but ranking goes through C-10 so every result gets explained and checked
async function runPipeline(embedder, rankAndExplainGrantRows) {
    const explained = [];
    const runHashes = [];
    const profileKey = (profile) => Object.keys(fixtures.profiles).find((key) => fixtures.profiles[key] === profile);
    const rankExplainAndCheck = async (profile, rows, options) => {
        const run = await rankAndExplainGrantRows(profile, rows, options);
        const byId = new Map(rows.map((row) => [Number(row.grant_id), row]));
        run.results.forEach((result) => explained.push({
            profile: profileKey(profile),
            grantId: String(result.grantId),
            disposition: result.disposition,
            rank: result.rank,
            claims: result.explanationDetails.claims.length,
            failedChecks: checkExplanation(result, byId.get(result.grantId)),
        }));
        runHashes.push({ profile: profileKey(profile), inputHash: run.inputHash, explanationHash: run.explanationHash });
        return run;
    };
    const report = await runEvaluation(fixtures, demoData, { embedder, rankGrantRows: rankExplainAndCheck });
    return { report, explained, runHashes };
}

function summarizeExplanations(explained) {
    const failuresByCheck = Object.fromEntries(Object.keys(CHECKS).map((code) => [code, 0]));
    explained.forEach((e) => e.failedChecks.forEach((code) => { failuresByCheck[code] += 1; }));
    return {
        results: explained.length,
        ranked: explained.filter((e) => e.rank !== null).length,
        blocked: explained.filter((e) => e.disposition === 'blocked').length,
        claims: explained.reduce((sum, e) => sum + e.claims, 0),
        resultsPassingAllChecks: explained.filter((e) => !e.failedChecks.length).length,
        checks: CHECKS,
        failuresByCheck,
        failing: explained.filter((e) => e.failedChecks.length),
    };
}

function buildSnapshot(first, second, explanationVersion, rankingVersions) {
    const { report } = first;
    const explanations = summarizeExplanations(first.explained);
    const reproducible = JSON.stringify(first.report) === JSON.stringify(second.report)
        && JSON.stringify(first.runHashes) === JSON.stringify(second.runHashes)
        && JSON.stringify(first.explained) === JSON.stringify(second.explained);
    const at3 = report.ranking.macro.atK[3];
    // pass/fail gates, so a later snapshot can be compared at a glance
    const gates = [
        ['every fixture label human-reviewed', report.review.reviewed === report.review.total, `${report.review.reviewed}/${report.review.total}`],
        ['no truly blocked grant let through (missed block rate 0)', report.screening.disposition.missedBlockRate === 0, report.screening.disposition.missedBlockRate],
        ['no wrongly blocked grant (false block rate 0)', report.screening.disposition.falseBlockRate === 0, report.screening.disposition.falseBlockRate],
        ['no not-modeled case passed as eligible', report.screening.notModeled.passedAsEligible.length === 0, report.screening.notModeled.passedAsEligible.length],
        ['no blocked grant ranked', report.ranking.blockedLeaks === 0, report.ranking.blockedLeaks],
        ['ranking beats random (nDCG@3)', at3.ndcg > at3.randomNdcg, `${at3.ndcg.toFixed(3)} vs ${at3.randomNdcg.toFixed(3)}`],
        ['every explanation passes every grounding check', explanations.failing.length === 0, `${explanations.resultsPassingAllChecks}/${explanations.results}`],
        ['two full runs give identical results and hashes', reproducible, reproducible],
    ].map(([name, pass, value]) => ({ name, pass, value }));

    return {
        snapshot: 'a14-integrated',
        generatedAt: new Date().toISOString(),
        git: gitInfo(),
        node: process.version,
        pipeline: [
            'Grants.gov listing (seeds/demo/opportunities.json, A-09)',
            'mapSourceDataToGrant (ingest row shape, text grant ids)',
            `screenGrantRow (C-06, ${SCREENING_VERSION})`,
            `rankGrantRows (C-09, ${rankingVersions.method})`,
            `rankAndExplainGrantRows (C-10, ${explanationVersion})`,
            'A-12 metrics against A-11 reviewed fixtures',
        ],
        versions: {
            fixtures: report.fixtureVersion,
            screening: SCREENING_VERSION,
            ranking: rankingVersions.method,
            rankingText: rankingVersions.text,
            explanation: explanationVersion,
            model: `${manifest.modelId}@${manifest.revision}:${manifest.quantization}-${manifest.executionProvider}`,
        },
        gates,
        allGatesPass: gates.every((g) => g.pass),
        review: report.review,
        screening: report.screening,
        ranking: report.ranking,
        explanations,
        reproducibility: { runs: 2, identical: reproducible, runHashes: first.runHashes },
    };
}

function printSummary(snapshot, outFile) {
    const pct = (v) => `${(v * 100).toFixed(1)}%`;
    const s = snapshot.screening;
    console.log(`A-14 integrated evaluation snapshot, ${snapshot.generatedAt}`);
    console.log(`  branch ${snapshot.git.branch}, head ${snapshot.git.head}, node ${snapshot.node}`);
    console.table(snapshot.versions);
    console.log('screening (77 reviewed cases)');
    console.table({
        'disposition accuracy': pct(s.disposition.accuracy),
        'false block rate': pct(s.disposition.falseBlockRate),
        'missed block rate': pct(s.disposition.missedBlockRate),
        'blocker precision': pct(s.blockers.micro.precision),
        'blocker recall': pct(s.blockers.micro.recall),
        'exact blocker match': pct(s.blockers.exactMatchRate),
    });
    console.log('ranking (5 profiles, macro-averaged)');
    console.table(Object.fromEntries(Object.entries(snapshot.ranking.macro.atK).map(([k, m]) => [`@${k}`, {
        precision: m.precision.toFixed(3), recall: m.recall.toFixed(3), ndcg: m.ndcg.toFixed(3), 'random ndcg': m.randomNdcg.toFixed(3),
    }])));
    const e = snapshot.explanations;
    console.log(`explanations: ${e.results} results (${e.ranked} ranked, ${e.blocked} blocked), ${e.claims} claims`);
    console.table(Object.fromEntries(Object.entries(e.failuresByCheck).map(([code, n]) => [code, { failures: n, check: e.checks[code] }])));
    console.log('gates');
    console.table(snapshot.gates.map((g) => ({ gate: g.name, result: g.pass ? 'PASS' : 'FAIL', value: String(g.value) })));
    console.log(snapshot.allGatesPass ? 'ALL GATES PASS' : 'SOME GATES FAILED');
    console.log(`snapshot saved to ${outFile}`);
}

async function main(args) {
    const outIndex = args.indexOf('--out');
    if (args.some((a, i) => a !== '--out' && i !== outIndex + 1) || (outIndex !== -1 && !args[outIndex + 1])) {
        console.error('usage: node src/scripts/evaluationSnapshot.js [--out snapshot.json]');
        process.exitCode = 1;
        return;
    }
    const outFile = outIndex === -1
        ? path.join(SERVER_ROOT, 'evaluation', 'snapshots', `a14-integrated-${new Date().toISOString().slice(0, 10)}.json`)
        : path.resolve(args[outIndex + 1]);

    // loading the model code lazily, same as evaluateMatching
    /* eslint-disable global-require */
    const { createLocalEmbedder } = require('../lib/localSemanticEmbedding');
    const { rankAndExplainGrantRows, EXPLANATION_VERSION } = require('../lib/groundedMatchExplanations');
    const { METHOD_VERSION, TEXT_VERSION } = require('../lib/semanticRanking');
    /* eslint-enable global-require */
    const embedder = await createLocalEmbedder({ allowDownload: false });
    try {
        const first = await runPipeline(embedder, rankAndExplainGrantRows);
        const second = await runPipeline(embedder, rankAndExplainGrantRows);
        const snapshot = buildSnapshot(first, second, EXPLANATION_VERSION, { method: METHOD_VERSION, text: TEXT_VERSION });
        fs.mkdirSync(path.dirname(outFile), { recursive: true });
        fs.writeFileSync(outFile, `${JSON.stringify(snapshot, null, 2)}\n`);
        printSummary(snapshot, path.relative(process.cwd(), outFile));
        if (!snapshot.allGatesPass) process.exitCode = 1;
    } finally {
        await embedder.dispose();
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(`snapshot failed (${err.code || 'ERROR'}): ${err.message}`);
        process.exitCode = 1;
    });
}

module.exports = { buildSnapshot, runPipeline, summarizeExplanations };
