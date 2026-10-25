const assert = require('assert').strict;
const fixtures = require('../../demo/semantic-ranking-fixtures.json');
const { createLocalEmbedder } = require('../lib/localSemanticEmbedding');
const { rankGrantRows, sourceText } = require('../lib/semanticRanking');
const { rankAndExplainGrantRows, EXPLANATION_VERSION } = require('../lib/groundedMatchExplanations');

async function rehearseGroundedMatches() {
    // Only already cached, checksum-pinned model assets. No implicit download or text-generation call.
    const embedder = await createLocalEmbedder();
    try {
        const options = { asOfDate: fixtures.asOfDate, expectedProfileVersion: fixtures.profile.version, embedder };
        const baseline = await rankGrantRows(fixtures.profile, fixtures.grants, options);
        const run = await rankAndExplainGrantRows(fixtures.profile, fixtures.grants, options);
        const reversedTextIds = [...fixtures.grants].reverse().map((row) => ({ ...row, grant_id: String(row.grant_id) }));
        assert.deepEqual(run, await rankAndExplainGrantRows(fixtures.profile, reversedTextIds, options));
        assert.equal(run.inputHash, baseline.inputHash);
        const rows = new Map(fixtures.grants.map((row) => [row.grant_id, row]));
        run.results.forEach((result, index) => {
            const { explanation, explanationDetails, ...unchanged } = result;
            const { explanation: previousExplanation, ...previous } = baseline.results[index];
            assert.deepEqual(unchanged, previous, 'Explanations cannot alter ranking/screening fields.');
            assert.equal(explanationDetails.verificationStatus, 'unverified');
            assert.equal(explanationDetails.version, EXPLANATION_VERSION);
            const evidence = new Map(explanationDetails.evidence.map((item) => [item.id, item]));
            explanationDetails.claims.forEach((claim) => {
                assert(claim.evidenceIds.length);
                claim.evidenceIds.forEach((id) => assert(evidence.has(id)));
                assert(explanation.includes(claim.text));
            });
            explanationDetails.evidence.filter((item) => item.kind === 'listingText').forEach((item) => {
                const field = sourceText(rows.get(result.grantId))[item.normalizedField];
                assert.equal(item.excerpt, field.slice(item.startOffset, item.endOffset));
                assert.equal(item.sourceTextHash, result.sourceTextHash);
            });
            result.blockers.forEach((blocker) => assert(explanation.includes(blocker.message)));
            result.uncertainties.forEach((warning) => assert(explanation.includes(warning)));
        });
        return {
            scope: 'Synthetic C-10 controls using the real cached ranker and extractive explanations; no live API, database, PDF citation, or generative AI evaluation.',
            checks: 'PASS: source-linked claims, exact excerpts, preserved scores/blockers/warnings, and repeatable reordered text IDs.',
            ...run,
        };
    } finally {
        await embedder.dispose();
    }
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.length > 1 || args.some((arg) => arg !== '--json')) {
        console.error('Usage: node packages/server/src/scripts/rehearseGroundedMatches.js [--json]');
        process.exitCode = 1;
    } else {
        rehearseGroundedMatches().then((run) => {
            if (args.includes('--json')) console.log(JSON.stringify(run, null, 2));
            else {
                console.log(run.scope);
                console.log(`Ranking model: ${run.model}`);
                console.log(`Explanation: ${run.explanationVersion} (${run.explanationMethod}); no text-generation model`);
                console.log(`Input SHA-256: ${run.inputHash}\nExplanation SHA-256: ${run.explanationHash}`);
                console.table(run.results.map((result) => ({
                    grantId: result.grantId,
                    rank: result.rank,
                    score: result.score,
                    disposition: result.disposition,
                    claims: result.explanationDetails.claims.length,
                    evidence: result.explanationDetails.evidence.length,
                    verification: result.explanationDetails.verificationStatus,
                })));
                const sample = run.results.find((result) => result.score !== null);
                if (sample) console.log(`Example explanation:\n${sample.explanation}`);
                console.log(run.checks);
            }
        }).catch((error) => {
            console.error(`C-10 rehearsal failed (${error.code || 'ERROR'}): ${error.message}`);
            process.exitCode = 1;
        });
    }
}

module.exports = { rehearseGroundedMatches };
