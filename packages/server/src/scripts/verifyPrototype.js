// A-15: verifying demo data and eval results before the demo, video and poster
// read-only, only writes evaluation/headline-numbers.json
//
// usage (inside the container):
//   yarn verify:prototype                          checking for today
//   yarn verify:prototype --demo-date 2026-12-04   checking which grants are open on demo day
//   yarn verify:prototype --db                     also checking the grants in the db
const fs = require('fs');
const path = require('path');
const { mapSourceDataToGrant } = require('../lib/grants-ingest');
const { listingDocument } = require('./buildFaithfulnessFixtures');

const ROOT = path.join(__dirname, '..', '..');
const EVAL = path.join(ROOT, 'evaluation');
const SNAPSHOTS = path.join(EVAL, 'snapshots');
const CLOSING_SOON_DAYS = 14;

const results = [];
function record(group, status, name, detail = '') {
    results.push({
        group, status, name, detail,
    });
}

function parseArgs(argv) {
    const args = { demoDate: new Date().toISOString().slice(0, 10), db: false };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--demo-date') args.demoDate = argv[i += 1];
        else if (argv[i] === '--db') args.db = true;
        else throw new Error(`unknown option ${argv[i]}`);
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(args.demoDate)) throw new Error('--demo-date needs YYYY-MM-DD');
    return args;
}

const daysBetween = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

// same rule as the app's search: closed on the close date, archived on the archive date
function statusOn(date, closeDate, archiveDate) {
    if (archiveDate && date >= archiveDate) return 'archived';
    if (closeDate && date >= closeDate) return 'closed';
    if (closeDate && daysBetween(date, closeDate) <= CLOSING_SOON_DAYS) return 'closing soon';
    return 'open';
}

function readJson(file) {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function latest(prefix) {
    if (!fs.existsSync(SNAPSHOTS)) return null;
    const files = fs.readdirSync(SNAPSHOTS).filter((f) => f.startsWith(prefix) && f.endsWith('.json')).sort();
    return files.length ? path.join(SNAPSHOTS, files[files.length - 1]) : null;
}

// no git in the container, so reading the commit from .git (same as A-14)
function gitHead() {
    // eslint-disable-next-line global-require
    return require('./evaluationSnapshot').gitInfo().head;
}

// --- 1. demo data ---

function checkDemoData(demo) {
    const list = demo.opportunities || [];
    const ids = list.map((o) => o.opportunity && o.opportunity.id);
    record('data', list.length === 11 ? 'PASS' : 'FAIL', 'demo file has the 11 listings', `${list.length} found, fetched ${demo.fetched_on}`);
    record('data', new Set(ids).size === ids.length ? 'PASS' : 'FAIL', 'every listing id is unique');

    const missing = list.filter((o) => {
        const p = o.opportunity || {};
        return !p.title || !p.description || !(p.milestones && p.milestones.close && p.milestones.close.date)
            || !(o.eligible_applicants || []).length;
    }).map((o) => o.opportunity.id);
    record('data', missing.length ? 'FAIL' : 'PASS', 'every listing has a title, description, close date and eligible applicants', missing.join(', '));

    const unreadable = [];
    list.forEach((o) => {
        try {
            mapSourceDataToGrant(o);
        } catch (err) {
            unreadable.push(`${o.opportunity.id}: ${err.message}`);
        }
    });
    record('data', unreadable.length ? 'FAIL' : 'PASS', 'every listing goes through the real ingest mapping', unreadable.join('; '));
    return ids;
}

function checkFixtures(demo, ids) {
    const matching = readJson(path.join(EVAL, 'matching-fixtures.json'));
    const used = [...new Set((matching.cases || []).map((c) => String(c.grantId)))];
    const unknown = used.filter((id) => !ids.includes(id));
    record('data', unknown.length ? 'FAIL' : 'PASS', 'A-11 reviewed cases only use demo grants', unknown.length ? `unknown: ${unknown.join(', ')}` : `${used.length} grants used`);

    const faithFile = path.join(EVAL, 'faithfulness-fixtures.json');
    if (!fs.existsSync(faithFile)) {
        record('data', 'WARN', 'A-16 test notices exist', 'run node src/scripts/buildFaithfulnessFixtures.js');
        return;
    }
    const saved = readJson(faithFile).documents.filter((d) => d.kind === 'listing');
    const fresh = demo.opportunities.map(listingDocument);
    const stale = fresh.filter((f) => {
        const s = saved.find((d) => d.id === f.id);
        return !s || JSON.stringify(s.pages) !== JSON.stringify(f.pages) || JSON.stringify(s.gold) !== JSON.stringify(f.gold);
    }).map((f) => f.id);
    record('data', stale.length ? 'FAIL' : 'PASS', 'A-16 test notices match the current demo data', stale.length ? `rebuild needed: ${stale.join(', ')}` : '');
}

// --- 2. demo day ---

function checkDemoDay(demo, demoDate) {
    const today = new Date().toISOString().slice(0, 10);
    const rows = demo.opportunities.map((o) => {
        const ms = o.opportunity.milestones;
        return {
            id: o.opportunity.id,
            title: o.opportunity.title.slice(0, 44),
            closes: ms.close.date,
            today: statusOn(today, ms.close.date, ms.archive_date),
            demoDay: statusOn(demoDate, ms.close.date, ms.archive_date),
        };
    });
    const gone = rows.filter((r) => r.demoDay === 'closed' || r.demoDay === 'archived');
    const soon = rows.filter((r) => r.demoDay === 'closing soon');
    record(
        'demo day',
        gone.length ? 'WARN' : 'PASS',
        `demo grants still open on ${demoDate}`,
        `${rows.length - gone.length} of ${rows.length} open${gone.length ? `; closed: ${gone.map((r) => r.id).join(', ')}` : ''}`,
    );
    if (soon.length) record('demo day', 'WARN', `closing within ${CLOSING_SOON_DAYS} days of ${demoDate}`, soon.map((r) => `${r.id} (${r.closes})`).join(', '));
    return rows;
}

// --- 3. database (optional) ---

async function checkDatabase(demo, demoDate) {
    // eslint-disable-next-line global-require
    const knex = require('../db/connection');
    try {
        const ids = demo.opportunities.map((o) => o.opportunity.id);
        const rows = await knex('grants').whereIn('grant_id', ids)
            .select('grant_id', 'revision_id', 'close_date', 'archive_date', 'opportunity_status');
        record('database', rows.length === ids.length ? 'PASS' : 'FAIL', 'all demo grants are loaded', `${rows.length} of ${ids.length}${rows.length < ids.length ? ' (run yarn demo:load)' : ''}`);

        const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
        const wrong = [];
        const staleStatus = [];
        demo.opportunities.forEach((o) => {
            const row = rows.find((r) => r.grant_id === o.opportunity.id);
            if (!row) return;
            const ms = o.opportunity.milestones;
            if (iso(row.close_date) !== ms.close.date || row.revision_id !== o.revision.id) wrong.push(o.opportunity.id);
            // saved status is only set at load time
            const real = statusOn(demoDate, ms.close.date, ms.archive_date).replace('closing soon', 'open').replace('open', 'posted');
            if (row.opportunity_status !== real) staleStatus.push(`${o.opportunity.id} saved "${row.opportunity_status}", really "${real}"`);
        });
        record('database', wrong.length ? 'FAIL' : 'PASS', 'loaded close dates and revisions match the demo file', wrong.join(', '));
        record(
            'database',
            staleStatus.length ? 'WARN' : 'PASS',
            `saved opportunity_status is still right on ${demoDate}`,
            staleStatus.length ? `${staleStatus.join('; ')}. the main search recalculates this, only the older grants list uses the saved value` : '',
        );
    } catch (err) {
        record('database', 'FAIL', 'database reachable', err.message);
    } finally {
        await knex.destroy();
    }
}

// --- 4. results ---

function currentVersions() {
    /* eslint-disable global-require */
    const versions = {};
    try { versions.screening = require('../lib/eligibilityBlockers').METHOD_VERSION; } catch (err) { /* left out */ }
    try {
        const r = require('../lib/semanticRanking');
        versions.ranking = r.METHOD_VERSION;
        versions.rankingText = r.TEXT_VERSION;
    } catch (err) { /* left out */ }
    try { versions.explanation = require('../lib/groundedMatchExplanations').EXPLANATION_VERSION; } catch (err) { /* left out */ }
    versions.fixtures = readJson(path.join(EVAL, 'matching-fixtures.json')).version;
    /* eslint-enable global-require */
    return versions;
}

function checkSnapshot() {
    const file = latest('a14-integrated-');
    if (!file) {
        record('results', 'FAIL', 'an A-14 snapshot exists', 'run yarn eval:snapshot');
        return null;
    }
    const snap = readJson(file);
    const name = path.basename(file);
    const failed = (snap.gates || []).filter((g) => !g.pass).map((g) => g.name);
    record('results', snap.allGatesPass && !failed.length ? 'PASS' : 'FAIL', `A-14 snapshot passes all ${(snap.gates || []).length} gates`, failed.length ? failed.join('; ') : name);

    const now = currentVersions();
    const changed = Object.keys(now).filter((k) => now[k] && snap.versions[k] !== now[k]).map((k) => `${k} ${snap.versions[k]} -> ${now[k]}`);
    record('results', changed.length ? 'FAIL' : 'PASS', 'snapshot was made with the current screening, ranking and explanation versions', changed.length ? `${changed.join('; ')}. rerun yarn eval:snapshot` : '');

    const head = gitHead();
    if (head) {
        const same = snap.git && snap.git.head === head;
        record('results', same ? 'PASS' : 'WARN', 'snapshot was made on the current commit', same ? head.slice(0, 8) : `snapshot ${snap.git ? snap.git.head.slice(0, 8) : '?'}, now ${head.slice(0, 8)}. rerun yarn eval:snapshot before the final numbers`);
    }
    return { snap, name };
}

function checkFaithfulness() {
    const live = latest('a16-faithfulness-live-') || latest('a16-faithfulness-replay-');
    if (!live) {
        record('results', 'WARN', 'A-16 faithfulness has a live ai run', 'only the free self-check so far. run yarn eval:faithfulness --live when ready');
        return null;
    }
    const report = readJson(live);
    const allMet = Object.values(report.targetResults || {}).every(Boolean);
    record('results', allMet ? 'PASS' : 'WARN', 'A-16 faithfulness targets met', path.basename(live));
    return { report, name: path.basename(live) };
}

function headlineNumbers(snapResult, faithResult, demoRows, demoDate) {
    const s = snapResult && snapResult.snap;
    const r = (x) => (typeof x === 'number' ? Math.round(x * 1000) / 1000 : null);
    const atK = s ? s.ranking.macro.atK : {};
    const numbers = {
        generatedAt: new Date().toISOString(),
        note: 'copy numbers for the poster, demo script and video from here so they always match',
        sources: { a14: snapResult && snapResult.name, a16: faithResult && faithResult.name },
        eligibility: s && {
            reviewedCases: `${s.review.reviewed}/${s.review.total}`,
            accuracy: r(s.screening.disposition.accuracy),
            missedBlockRate: r(s.screening.disposition.missedBlockRate),
            falseBlockRate: r(s.screening.disposition.falseBlockRate),
            blockerRecall: r(s.screening.blockers.micro.recall),
            notModeledPassedAsEligible: `${s.screening.notModeled.passedAsEligible.length} of ${s.screening.notModeled.cases}`,
        },
        ranking: s && {
            blockedGrantsRanked: s.ranking.blockedLeaks,
            ndcgAt1: r(atK['1'] && atK['1'].ndcg),
            ndcgAt3: r(atK['3'] && atK['3'].ndcg),
            ndcgAt5: r(atK['5'] && atK['5'].ndcg),
            randomNdcgAt1: r(atK['1'] && atK['1'].randomNdcg),
            randomNdcgAt3: r(atK['3'] && atK['3'].randomNdcg),
            randomNdcgAt5: r(atK['5'] && atK['5'].randomNdcg),
            profiles: s.ranking.profiles,
        },
        explanations: s && {
            passingAllChecks: `${s.explanations.resultsPassingAllChecks}/${s.explanations.results}`,
            claims: s.explanations.claims,
            reproducible: s.reproducibility.identical,
        },
        faithfulness: faithResult ? {
            mode: faithResult.report.mode,
            factsBackedByQuote: `${faithResult.report.summary.supportedFacts}/${faithResult.report.summary.facts}`,
            recall: r(faithResult.report.summary.answerKey.recall),
            inventedFacts: faithResult.report.summary.answerKey.inventedFacts,
        } : 'no live run yet',
        demoDay: {
            date: demoDate,
            openGrants: demoRows.filter((x) => x.demoDay === 'open' || x.demoDay === 'closing soon').length,
            totalGrants: demoRows.length,
        },
    };
    fs.writeFileSync(path.join(EVAL, 'headline-numbers.json'), `${JSON.stringify(numbers, null, 2)}\n`);
    return numbers;
}

function print(demoRows, demoDate, numbers) {
    console.log(`\nA-15 prototype verification (demo date ${demoDate})`);
    console.log('='.repeat(60));
    let group = null;
    results.forEach((x) => {
        if (x.group !== group) {
            group = x.group;
            console.log(`\n${group}`);
        }
        console.log(`  ${x.status.padEnd(4)}  ${x.name}${x.detail ? `\n          ${x.detail}` : ''}`);
    });

    console.log(`\ndemo grants on ${demoDate}:`);
    console.table(demoRows.map((x) => ({
        id: x.id, title: x.title, closes: x.closes, today: x.today, [demoDate]: x.demoDay,
    })));

    if (numbers.eligibility) {
        const e = numbers.eligibility;
        const k = numbers.ranking;
        console.log('headline numbers (also saved to evaluation/headline-numbers.json):');
        console.log(`  eligibility accuracy ${e.accuracy * 100}% on ${e.reviewedCases} reviewed cases, missed blocks ${e.missedBlockRate}, false blocks ${e.falseBlockRate}`);
        console.log(`  blocked grants ranked: ${k.blockedGrantsRanked} | nDCG@1/3/5 ${k.ndcgAt1}/${k.ndcgAt3}/${k.ndcgAt5} vs random ${k.randomNdcgAt1}/${k.randomNdcgAt3}/${k.randomNdcgAt5}`);
        console.log(`  explanations passing all checks: ${numbers.explanations.passingAllChecks}`);
        console.log(`  faithfulness: ${typeof numbers.faithfulness === 'string' ? numbers.faithfulness : `${numbers.faithfulness.factsBackedByQuote} facts backed by a quote, ${numbers.faithfulness.inventedFacts} invented`}`);
    }

    const fails = results.filter((x) => x.status === 'FAIL').length;
    const warns = results.filter((x) => x.status === 'WARN').length;
    console.log(`\n${fails ? `${fails} FAIL` : 'no failures'}, ${warns} warning(s)`);
    if (fails) process.exitCode = 1;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const demo = readJson(path.join(ROOT, 'seeds', 'demo', 'opportunities.json'));
    const ids = checkDemoData(demo);
    checkFixtures(demo, ids);
    const demoRows = checkDemoDay(demo, args.demoDate);
    if (args.db) await checkDatabase(demo, args.demoDate);
    const snap = checkSnapshot();
    const faith = checkFaithfulness();
    const numbers = headlineNumbers(snap, faith, demoRows, args.demoDate);
    print(demoRows, args.demoDate, numbers);
}

if (require.main === module) {
    main().catch((err) => {
        console.error(err.message || err);
        process.exitCode = 1;
    });
}

module.exports = { statusOn };
