#!/usr/bin/env node
// scoring the eligibility screener and semantic ranker against the reviewed fixtures (tasks A-11, A-12).
// grants go through the same mapping the ingest consumer uses, so the screener sees real row shapes.
// no db, no network, no paid api. ranking needs the pinned model cached once (see docs/g32-c09-semantic-ranking.md).
// usage: yarn eval:matching                      (blockers + ranking)
//        yarn eval:matching --screening-only     (blockers only, skips the model)
//        yarn eval:matching --out report.json    (also saving the full report)
const fs = require('fs');
const path = require('path');
const fixtures = require('../../evaluation/matching-fixtures.json');
const demoData = require('../../seeds/demo/opportunities.json');
const { mapSourceDataToGrant } = require('../lib/grants-ingest');
const { screenGrantRow } = require('../lib/grantsEligibilityAdapter');
const { METHOD_VERSION: SCREENING_VERSION } = require('../lib/eligibilityBlockers');
const {
    blockerMetrics, dispositionMetrics, macroAverage, randomBaseline, rankingMetrics,
} = require('../lib/evaluation-metrics');

const KS = [1, 3, 5];

// same rules as mapSourceDataToGrant, but on the scenario date instead of today, so reruns match
function statusOn(row, asOfDate) {
    if (row.archive_date && asOfDate >= row.archive_date) return 'archived';
    if (asOfDate >= row.close_date) return 'closed';
    if (row.open_date && asOfDate < row.open_date) return 'forecasted';
    return 'posted';
}

function buildRow(event, asOfDate) {
    const row = mapSourceDataToGrant(event);
    row.opportunity_status = statusOn(row, asOfDate);
    // ingest keeps grant_id as a string but the ranker only takes integers, converting here (see doc, finding 1)
    row.grant_id = Number(row.grant_id);
    return row;
}

function reviewSummary(cases) {
    const reviewed = cases.filter((c) => c.review && c.review.status === 'reviewed');
    return {
        total: cases.length,
        reviewed: reviewed.length,
        draft: cases.length - reviewed.length,
        changedInReview: reviewed.filter((c) => c.review.changed).length,
        reviewers: [...new Set(reviewed.map((c) => c.review.reviewer).filter(Boolean))],
    };
}

/**
 * runs every fixture case through the screener, and the ranking scenarios through the ranker.
 * @param { { embedder?: object, rankGrantRows?: Function } } deps leaving both out skips ranking
 */
async function runEvaluation(fx = fixtures, demo = demoData, { embedder, rankGrantRows } = {}) {
    const events = new Map(demo.opportunities.map((o) => [String(o.opportunity.id), o]));
    const scenarios = new Map(fx.scenarios.map((s) => [s.id, s]));

    // screening every case
    const screened = fx.cases.map((c) => {
        const { asOfDate } = scenarios.get(c.scenario);
        const result = screenGrantRow(fx.profiles[c.profile], buildRow(events.get(c.grantId), asOfDate), { asOfDate });
        return {
            ...c,
            predicted: {
                disposition: result.disposition,
                blockers: result.blockers.map((b) => b.code).sort(),
                uncertainties: result.uncertainties,
            },
        };
    });

    const screening = {
        disposition: dispositionMetrics(screened.map((c) => ({ expected: c.expected.disposition, predicted: c.predicted.disposition }))),
        blockers: blockerMetrics(screened.map((c) => ({ expected: c.expected.blockers, predicted: c.predicted.blockers }))),
        byScenario: Object.fromEntries(fx.scenarios.map((s) => {
            const subset = screened.filter((c) => c.scenario === s.id);
            return [s.id, {
                asOfDate: s.asOfDate,
                disposition: dispositionMetrics(subset.map((c) => ({ expected: c.expected.disposition, predicted: c.predicted.disposition }))),
                blockers: blockerMetrics(subset.map((c) => ({ expected: c.expected.blockers, predicted: c.predicted.blockers }))),
            }];
        })),
        // ineligible for reasons the screener has no rule for (geography, applicant limits only in the text)
        notModeled: {
            cases: screened.filter((c) => c.expected.notModeled.length).length,
            passedAsEligible: screened.filter((c) => c.expected.notModeled.length && c.predicted.disposition === 'eligible')
                .map((c) => c.id),
        },
        mismatches: screened.filter((c) => c.predicted.disposition !== c.expected.disposition
            || c.predicted.blockers.join() !== c.expected.blockers.join())
            .map((c) => ({
                id: c.id, expected: c.expected, predicted: c.predicted, rationale: c.rationale,
            })),
    };

    // ranking each profile in the ranking scenarios
    let ranking = null;
    if (embedder && rankGrantRows) {
        const runs = [];
        for (const scenario of fx.scenarios.filter((s) => s.evaluateRanking)) {
            const profileIds = [...new Set(fx.cases.filter((c) => c.scenario === scenario.id).map((c) => c.profile))];
            for (const profileId of profileIds) {
                const cases = fx.cases.filter((c) => c.scenario === scenario.id && c.profile === profileId);
                const profile = fx.profiles[profileId];
                const rows = cases.map((c) => buildRow(events.get(c.grantId), scenario.asOfDate));
                // eslint-disable-next-line no-await-in-loop
                const run = await rankGrantRows(profile, rows, {
                    asOfDate: scenario.asOfDate, expectedProfileVersion: profile.version, embedder,
                });
                const ranked = run.results.filter((r) => r.rank !== null).sort((a, b) => a.rank - b.rank);
                const rankedIds = ranked.map((r) => String(r.grantId));
                // the ideal list is every grant that truly isn't blocked, with its reviewed relevance
                const relevance = Object.fromEntries(cases.filter((c) => c.expected.disposition !== 'blocked')
                    .map((c) => [c.grantId, c.expected.relevance]));
                const blockedIds = new Set(cases.filter((c) => c.expected.disposition === 'blocked').map((c) => c.grantId));
                runs.push({
                    scenario: scenario.id,
                    profile: profileId,
                    focusAreas: profile.focusAreas,
                    model: run.model,
                    inputHash: run.inputHash,
                    ranked: ranked.map((r) => ({
                        grantId: String(r.grantId), rank: r.rank, score: r.score, relevance: relevance[String(r.grantId)] ?? null,
                    })),
                    // truly blocked grants that still got a rank, should always be empty
                    blockedLeaks: rankedIds.filter((id) => blockedIds.has(id)),
                    metrics: rankingMetrics(rankedIds, relevance, KS),
                    randomBaseline: randomBaseline(relevance, KS),
                });
            }
        }
        const avg = (pick) => macroAverage(runs, pick);
        ranking = {
            model: runs[0] ? runs[0].model : null,
            profiles: runs.length,
            blockedLeaks: runs.reduce((sum, r) => sum + r.blockedLeaks.length, 0),
            macro: {
                reciprocalRank: avg((r) => r.metrics.reciprocalRank),
                randomReciprocalRank: avg((r) => r.randomBaseline.reciprocalRank),
                atK: Object.fromEntries(KS.map((k) => [k, {
                    precision: avg((r) => r.metrics.atK[k].precision),
                    recall: avg((r) => r.metrics.atK[k].recall),
                    ndcg: avg((r) => r.metrics.atK[k].ndcg),
                    randomNdcg: avg((r) => r.randomBaseline.atK[k].ndcg),
                }])),
            },
            runs,
        };
    }

    return {
        fixtureVersion: fx.fixtureVersion,
        screeningMethodVersion: SCREENING_VERSION,
        review: reviewSummary(fx.cases),
        screening,
        ranking,
    };
}

const pct = (v) => (v === null || v === undefined ? 'n/a' : `${(v * 100).toFixed(1)}%`);
const num = (v) => (v === null || v === undefined ? 'n/a' : v.toFixed(3));

function printReport(report) {
    const { review, screening, ranking } = report;
    console.log(`\nfixtures ${report.fixtureVersion}, screener ${report.screeningMethodVersion}`);
    if (review.draft) {
        console.log(`\n  !! ${review.draft} of ${review.total} labels are still DRAFT (not human-reviewed).`);
        console.log('  !! run `python review_matching_fixtures.py` before reporting these numbers.');
    } else {
        console.log(`  all ${review.total} labels reviewed by ${review.reviewers.join(', ')} (${review.changedInReview} changed in review)`);
    }

    console.log('\nblocker screening');
    const d = screening.disposition;
    const b = screening.blockers;
    console.table({
        'disposition accuracy': pct(d.accuracy),
        'false block rate': pct(d.falseBlockRate),
        'missed block rate': pct(d.missedBlockRate),
        'blocker precision': pct(b.micro.precision),
        'blocker recall': pct(b.micro.recall),
        'blocker f1': pct(b.micro.f1),
        'exact blocker match': pct(b.exactMatchRate),
    });
    console.log('confusion matrix (rows = expected, cols = predicted)');
    console.table(d.matrix);
    console.log('per blocker code');
    console.table(Object.fromEntries(Object.entries(b.byCode).map(([code, m]) => [code, {
        tp: m.tp, fp: m.fp, fn: m.fn, precision: pct(m.precision), recall: pct(m.recall),
    }])));
    console.log(`not-modeled ineligibility: ${screening.notModeled.cases} cases, `
        + `${screening.notModeled.passedAsEligible.length} passed as eligible`);
    if (screening.mismatches.length) {
        console.log(`\nmismatches (${screening.mismatches.length})`);
        console.table(screening.mismatches.map((m) => ({
            case: m.id,
            expected: `${m.expected.disposition} ${m.expected.blockers.join(',')}`.trim(),
            predicted: `${m.predicted.disposition} ${m.predicted.blockers.join(',')}`.trim(),
        })));
    }

    if (!ranking) {
        console.log('\nranking skipped (--screening-only)');
        return;
    }
    console.log(`\nsemantic ranking, ${ranking.model}`);
    console.table(ranking.runs.map((r) => ({
        profile: r.profile,
        ranked: r.metrics.rankedCount,
        relevant: r.metrics.relevantCount,
        'p@3': num(r.metrics.atK[3].precision),
        'ndcg@3': num(r.metrics.atK[3].ndcg),
        'random ndcg@3': num(r.randomBaseline.atK[3].ndcg),
        rr: num(r.metrics.reciprocalRank),
        'random rr': num(r.randomBaseline.reciprocalRank),
        leaks: r.blockedLeaks.length,
    })));
    const m = ranking.macro;
    console.table(Object.fromEntries(KS.map((k) => [`@${k}`, {
        precision: num(m.atK[k].precision), recall: num(m.atK[k].recall), ndcg: num(m.atK[k].ndcg), 'random ndcg': num(m.atK[k].randomNdcg),
    }])));
    console.log(`mean reciprocal rank ${num(m.reciprocalRank)} (random ${num(m.randomReciprocalRank)}), `
        + `blocked grants that got ranked: ${ranking.blockedLeaks}`);
    console.log('top 3 per profile');
    ranking.runs.forEach((r) => {
        console.log(`  ${r.profile}: ${r.ranked.slice(0, 3).map((x) => `${x.grantId} (score ${x.score}, rel ${x.relevance})`).join(', ')}`);
    });
}

async function main(args) {
    const known = ['--screening-only', '--download-model', '--json', '--out'];
    const outIndex = args.indexOf('--out');
    const outFile = outIndex === -1 ? null : args[outIndex + 1];
    if (args.some((a, i) => !known.includes(a) && i !== outIndex + 1) || (outIndex !== -1 && !outFile)) {
        console.error('usage: node src/scripts/evaluateMatching.js [--screening-only] [--download-model] [--json] [--out report.json]');
        process.exitCode = 1;
        return;
    }
    let deps = {};
    let embedder = null;
    if (!args.includes('--screening-only')) {
        // loading the model code lazily, so --screening-only works without the onnx deps installed
        // eslint-disable-next-line global-require
        const { createLocalEmbedder } = require('../lib/localSemanticEmbedding');
        // eslint-disable-next-line global-require
        const { rankGrantRows } = require('../lib/semanticRanking');
        embedder = await createLocalEmbedder({ allowDownload: args.includes('--download-model') });
        deps = { embedder, rankGrantRows };
    }
    try {
        const report = await runEvaluation(fixtures, demoData, deps);
        if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
        else printReport(report);
        if (outFile) {
            fs.writeFileSync(path.resolve(outFile), `${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`);
            console.log(`\nfull report saved to ${outFile}`);
        }
    } finally {
        if (embedder) await embedder.dispose();
    }
}

if (require.main === module) {
    main(process.argv.slice(2)).catch((err) => {
        console.error(`evaluation failed (${err.code || 'ERROR'}): ${err.message}`);
        process.exitCode = 1;
    });
}

module.exports = { buildRow, runEvaluation, statusOn };
