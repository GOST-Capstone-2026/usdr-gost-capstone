const { expect } = require('chai');
const {
    blockerMetrics, dispositionMetrics, macroAverage, randomBaseline, rankingMetrics,
} = require('../../src/lib/evaluation-metrics');

describe('evaluation-metrics', () => {
    describe('blockerMetrics', () => {
        it('counts each (case, code) pair as one prediction', () => {
            const result = blockerMetrics([
                { expected: ['A', 'B'], predicted: ['A'] }, // one hit, one miss
                { expected: [], predicted: ['C'] }, // one false alarm
                { expected: ['A'], predicted: ['A'] }, // exact
            ]);
            expect(result.micro).to.include({ tp: 2, fp: 1, fn: 1 });
            expect(result.micro.precision).to.be.closeTo(2 / 3, 1e-9);
            expect(result.micro.recall).to.be.closeTo(2 / 3, 1e-9);
            expect(result.micro.f1).to.be.closeTo(2 / 3, 1e-9);
            expect(result.exactMatchRate).to.be.closeTo(1 / 3, 1e-9);
            expect(result.byCode.A).to.include({
                tp: 2, fp: 0, fn: 0, precision: 1,
            });
            expect(result.byCode.B).to.include({ tp: 0, fn: 1, recall: 0 });
        });

        it('returns null instead of NaN when nothing was expected or predicted', () => {
            const result = blockerMetrics([{ expected: [], predicted: [] }]);
            expect(result.micro).to.include({ precision: null, recall: null, f1: null });
            expect(result.exactMatchRate).to.equal(1);
        });
    });

    describe('dispositionMetrics', () => {
        it('builds the confusion matrix and both safety rates', () => {
            const result = dispositionMetrics([
                { expected: 'eligible', predicted: 'eligible' },
                { expected: 'eligible', predicted: 'blocked' }, // false block
                { expected: 'reviewRequired', predicted: 'reviewRequired' },
                { expected: 'blocked', predicted: 'reviewRequired' }, // missed block
                { expected: 'blocked', predicted: 'blocked' },
            ]);
            expect(result.accuracy).to.equal(3 / 5);
            expect(result.matrix.eligible).to.deep.equal({ eligible: 1, reviewRequired: 0, blocked: 1 });
            expect(result.falseBlockRate).to.equal(1 / 3);
            expect(result.missedBlockRate).to.equal(1 / 2);
        });

        it('rejects a disposition it does not know', () => {
            expect(() => dispositionMetrics([{ expected: 'eligible', predicted: 'maybe' }])).to.throw(/unknown disposition/);
        });
    });

    describe('rankingMetrics', () => {
        const relevance = {
            a: 2, b: 1, c: 0, d: 0,
        };

        it('scores a perfect ranking as ndcg 1 and rr 1', () => {
            const result = rankingMetrics(['a', 'b', 'c', 'd'], relevance, [1, 3]);
            expect(result.reciprocalRank).to.equal(1);
            expect(result.atK[1]).to.deep.equal({ precision: 1, recall: 0.5, ndcg: 1 });
            expect(result.atK[3].ndcg).to.equal(1);
            expect(result.atK[3].recall).to.equal(1);
        });

        it('matches a hand-worked ndcg for a worse ranking', () => {
            // dcg@3 = 0 + 1/log2(3) + 3/log2(4), ideal = 3 + 1/log2(3)
            const result = rankingMetrics(['c', 'b', 'a', 'd'], relevance, [3]);
            const expected = (1 / Math.log2(3) + 3 / 2) / (3 + 1 / Math.log2(3));
            expect(result.atK[3].ndcg).to.be.closeTo(expected, 1e-9);
            expect(result.reciprocalRank).to.equal(0.5);
        });

        it('treats a ranked grant missing from the labels (e.g. should have been blocked) as not relevant', () => {
            const result = rankingMetrics(['leaked', 'a'], { a: 2 }, [1]);
            expect(result.atK[1].precision).to.equal(0);
            expect(result.reciprocalRank).to.equal(0.5);
        });

        it('gives rr 0 when nothing relevant was ranked and null when nothing was relevant', () => {
            expect(rankingMetrics(['c'], relevance, [1]).reciprocalRank).to.equal(0);
            expect(rankingMetrics(['c'], { c: 0 }, [1]).reciprocalRank).to.equal(null);
        });
    });

    describe('randomBaseline', () => {
        it('matches the brute-force average over every ordering', () => {
            const relevance = {
                a: 2, b: 1, c: 0, d: 0,
            };
            const permute = (items) => (items.length <= 1 ? [items] : items.flatMap(
                (item, i) => permute([...items.slice(0, i), ...items.slice(i + 1)]).map((rest) => [item, ...rest]),
            ));
            const orders = permute(Object.keys(relevance));
            const mean = (pick) => orders.reduce((sum, order) => sum + pick(rankingMetrics(order, relevance, [1, 3])), 0) / orders.length;

            const baseline = randomBaseline(relevance, [1, 3]);
            expect(baseline.reciprocalRank).to.be.closeTo(mean((m) => m.reciprocalRank), 1e-9);
            expect(baseline.atK[3].precision).to.be.closeTo(mean((m) => m.atK[3].precision), 1e-9);
            expect(baseline.atK[3].recall).to.be.closeTo(mean((m) => m.atK[3].recall), 1e-9);
            // ndcg baseline is expected dcg / ideal dcg, which equals the mean ndcg since ideal is fixed
            expect(baseline.atK[3].ndcg).to.be.closeTo(mean((m) => m.atK[3].ndcg), 1e-9);
        });
    });

    describe('macroAverage', () => {
        it('skips profiles where the metric is undefined', () => {
            expect(macroAverage([{ v: 1 }, { v: null }, { v: 0 }], (r) => r.v)).to.equal(0.5);
            expect(macroAverage([{ v: null }], (r) => r.v)).to.equal(null);
        });
    });
});
