const assert = require('assert').strict;
const fixtures = require('../../demo/semantic-ranking-fixtures.json');
const { createLocalEmbedder } = require('../lib/localSemanticEmbedding');
const { rankGrantRows } = require('../lib/semanticRanking');

async function rehearseSemanticRanking({ allowDownload = false } = {}) {
    const embedder = await createLocalEmbedder({ allowDownload });
    try {
        const options = { asOfDate: fixtures.asOfDate, expectedProfileVersion: fixtures.profile.version, embedder };
        const result = await rankGrantRows(fixtures.profile, fixtures.grants, options);
        const repeated = await rankGrantRows(fixtures.profile, fixtures.grants, options);
        const reordered = await rankGrantRows(fixtures.profile, [...fixtures.grants].reverse(), options);
        assert.deepEqual(result, repeated, 'Identical fixed inputs must produce identical results on this runtime.');
        assert.deepEqual(result, reordered, 'Candidate order must not change the results or input hash.');
        const byId = new Map(result.results.map((item) => [item.grantId, item]));
        fixtures.relevantGrantIds.forEach((id) => {
            assert(byId.get(id).score > byId.get(fixtures.unrelatedGrantId).score, 'Relevant synthetic controls should outrank the library control.');
        });
        fixtures.blockedGrantIds.forEach((id) => {
            assert.equal(byId.get(id).disposition, 'blocked');
            assert.equal(byId.get(id).rank, null);
            assert.equal(byId.get(id).score, null);
        });
        assert.equal(byId.get(fixtures.missingTextGrantId).disposition, 'reviewRequired');
        assert.equal(byId.get(fixtures.missingTextGrantId).rank, null);
        assert.equal(byId.get(930003).disposition, 'reviewRequired', 'Semantic similarity cannot erase unrestricted-applicant review.');
        assert.equal(result.rankedCount, 3);
        assert.equal(result.blockedCount, 2);
        return { scope: fixtures.scope, checks: 'PASS: real model, repeated run, candidate-order invariance, relevance controls, blockers, and missing-text control.', ...result };
    } finally {
        await embedder.dispose();
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (new Set(args).size !== args.length || args.some((arg) => !['--download-model', '--json'].includes(arg))) {
        console.error('Usage: node packages/server/src/scripts/rehearseSemanticRanking.js [--download-model] [--json]');
        process.exitCode = 1;
    } else {
        rehearseSemanticRanking({ allowDownload: args.includes('--download-model') }).then((run) => {
            if (args.includes('--json')) console.log(JSON.stringify(run, null, 2));
            else {
                console.log(run.scope);
                console.log(`Model: ${run.model}`);
                console.log(`Input SHA-256: ${run.inputHash}`);
                console.table(run.results.map((result) => ({
                    grantId: result.grantId,
                    rank: result.rank,
                    score: result.score,
                    disposition: result.disposition,
                    blockers: result.blockers.map(({ code }) => code).join(', ') || 'none',
                    warnings: result.uncertainties.length,
                })));
                console.log(run.checks);
            }
        }).catch((error) => {
            console.error(`C-09 rehearsal failed (${error.code || 'ERROR'}): ${error.message}`);
            process.exitCode = 1;
        });
    }
}

module.exports = { rehearseSemanticRanking };
