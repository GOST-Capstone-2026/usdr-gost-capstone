// scoring the matcher against the reviewed fixtures (task A-12).
// keeping these pure (no db, no model) so the numbers are easy to test and rerun.
// blocker metrics: treating each (case, blocker code) pair as one prediction, like multi-label classification.
// ranking metrics: the usual ir ones, precision@k, recall@k, ndcg@k and reciprocal rank.

const DISPOSITIONS = ['eligible', 'reviewRequired', 'blocked'];

// returning null instead of NaN when there's nothing to divide by
const ratio = (num, den) => (den ? num / den : null);

function prf(tp, fp, fn) {
    const precision = ratio(tp, tp + fp);
    const recall = ratio(tp, tp + fn);
    const f1 = precision !== null && recall !== null && precision + recall > 0
        ? (2 * precision * recall) / (precision + recall) : null;
    return {
        tp, fp, fn, precision, recall, f1,
    };
}

/**
 * scoring blocker codes: precision/recall/f1, micro-averaged and per code.
 * @param { { expected: string[], predicted: string[] }[] } cases
 */
function blockerMetrics(cases) {
    const perCode = {};
    const bump = (code, key) => {
        perCode[code] = perCode[code] || { tp: 0, fp: 0, fn: 0 };
        perCode[code][key] += 1;
    };
    let tp = 0;
    let fp = 0;
    let fn = 0;
    let exact = 0;
    cases.forEach(({ expected, predicted }) => {
        const want = new Set(expected);
        const got = new Set(predicted);
        got.forEach((code) => {
            if (want.has(code)) { tp += 1; bump(code, 'tp'); } else { fp += 1; bump(code, 'fp'); }
        });
        want.forEach((code) => {
            if (!got.has(code)) { fn += 1; bump(code, 'fn'); }
        });
        if (want.size === got.size && [...want].every((code) => got.has(code))) exact += 1;
    });
    const byCode = Object.fromEntries(Object.keys(perCode).sort()
        .map((code) => [code, prf(perCode[code].tp, perCode[code].fp, perCode[code].fn)]));
    return {
        cases: cases.length,
        exactMatchRate: ratio(exact, cases.length),
        micro: prf(tp, fp, fn),
        byCode,
    };
}

/**
 * scoring dispositions: accuracy, confusion matrix (rows = expected, cols = predicted) and two safety rates.
 * falseBlockRate = share of not-blocked cases the screener blocked (hiding a grant the org could apply for)
 * missedBlockRate = share of blocked cases the screener let through to ranking
 * @param { { expected: string, predicted: string }[] } cases
 */
function dispositionMetrics(cases) {
    const matrix = Object.fromEntries(DISPOSITIONS.map((row) => [row, Object.fromEntries(DISPOSITIONS.map((col) => [col, 0]))]));
    let correct = 0;
    cases.forEach(({ expected, predicted }) => {
        if (!matrix[expected] || !(predicted in matrix[expected])) {
            throw new Error(`unknown disposition: expected ${expected}, predicted ${predicted}`);
        }
        matrix[expected][predicted] += 1;
        if (expected === predicted) correct += 1;
    });
    const notBlocked = cases.filter((c) => c.expected !== 'blocked');
    const blocked = cases.filter((c) => c.expected === 'blocked');
    return {
        cases: cases.length,
        accuracy: ratio(correct, cases.length),
        matrix,
        falseBlockRate: ratio(notBlocked.filter((c) => c.predicted === 'blocked').length, notBlocked.length),
        missedBlockRate: ratio(blocked.filter((c) => c.predicted !== 'blocked').length, blocked.length),
    };
}

// using graded gain so a "directly relevant" grant counts more than a "partly relevant" one
const gain = (relevance) => 2 ** relevance - 1;
const discount = (position) => 1 / Math.log2(position + 1);

function dcg(relevances, k) {
    return relevances.slice(0, k).reduce((sum, rel, i) => sum + gain(rel) * discount(i + 1), 0);
}

/**
 * scoring one ranked list for one profile.
 * @param { string[] } ranked grant ids in the order the matcher ranked them
 * @param { Record<string, number> } relevance reviewed 0/1/2 label for every grant that should be rankable
 * @param { number[] } ks cutoffs to report
 */
function rankingMetrics(ranked, relevance, ks = [1, 3, 5]) {
    // counting anything ranked that isn't labeled (e.g. a grant that should've been blocked) as 0
    const rels = ranked.map((id) => relevance[id] ?? 0);
    const ideal = Object.values(relevance).sort((a, b) => b - a);
    const relevantCount = ideal.filter((rel) => rel > 0).length;
    const firstHit = rels.findIndex((rel) => rel > 0);
    const atK = {};
    ks.forEach((k) => {
        const hits = rels.slice(0, k).filter((rel) => rel > 0).length;
        const idealDcg = dcg(ideal, k);
        atK[k] = {
            precision: ratio(hits, Math.min(k, ranked.length)),
            recall: ratio(hits, relevantCount),
            ndcg: ratio(dcg(rels, k), idealDcg),
        };
    });
    // null when nothing was relevant, 0 when nothing relevant got ranked
    let reciprocalRank = null;
    if (relevantCount) reciprocalRank = firstHit === -1 ? 0 : 1 / (firstHit + 1);
    return {
        rankedCount: ranked.length,
        relevantCount,
        reciprocalRank,
        atK,
    };
}

/**
 * working out what a random ordering of the same candidates scores on average.
 * computing it exactly instead of shuffling, since every grant is equally likely to land in each spot.
 * ndcg here is expected dcg over ideal dcg.
 * @param { Record<string, number> } relevance
 * @param { number[] } ks
 */
function randomBaseline(relevance, ks = [1, 3, 5]) {
    const rels = Object.values(relevance);
    const n = rels.length;
    const ideal = [...rels].sort((a, b) => b - a);
    const relevantCount = rels.filter((rel) => rel > 0).length;
    const totalGain = rels.reduce((sum, rel) => sum + gain(rel), 0);
    // adding up (chance the first relevant grant lands at position p) * 1/p
    let expectedRr = null;
    if (relevantCount) {
        expectedRr = 0;
        let noneYet = 1;
        for (let p = 1; p <= n - relevantCount + 1; p += 1) {
            const hitHere = noneYet * (relevantCount / (n - p + 1));
            expectedRr += hitHere / p;
            noneYet -= hitHere;
        }
    }
    const atK = {};
    ks.forEach((k) => {
        const cut = Math.min(k, n);
        let meanDiscount = 0;
        for (let p = 1; p <= cut; p += 1) meanDiscount += discount(p) / n;
        atK[k] = {
            precision: ratio(relevantCount, n),
            recall: ratio(relevantCount * (cut / n), relevantCount),
            ndcg: ratio(totalGain * meanDiscount, dcg(ideal, k)),
        };
    });
    return {
        candidates: n, relevantCount, reciprocalRank: expectedRr, atK,
    };
}

// averaging per-profile numbers, skipping profiles where a metric is undefined (null)
function macroAverage(runs, pick) {
    const values = runs.map(pick).filter((v) => v !== null && v !== undefined);
    return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

module.exports = {
    DISPOSITIONS,
    blockerMetrics,
    dispositionMetrics,
    macroAverage,
    randomBaseline,
    rankingMetrics,
};
