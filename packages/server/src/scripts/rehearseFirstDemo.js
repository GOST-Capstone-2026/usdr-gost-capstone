// C-07 partial rehearsal: synthetic inputs, real screening and source-page chunking code.
const assert = require('assert').strict;
const fixtures = require('../../demo/first-demo-fixtures.json');
const { screenGrantRow } = require('../lib/grantsEligibilityAdapter');
const { chunkPages } = require('../lib/documentChunking');

function rehearseFirstDemo() {
    const results = fixtures.cases.map((scenario) => {
        const result = screenGrantRow(fixtures.profile, scenario.grant, { asOfDate: fixtures.asOfDate });
        assert.equal(result.disposition, scenario.expectedDisposition, scenario.name);
        assert.deepEqual(result.blockers.map((blocker) => blocker.code), scenario.expectedBlockers, scenario.name);
        return { name: scenario.name, ...result };
    });
    const selected = results.find((result) => result.grantId === fixtures.document.grantId);
    assert.equal(selected.disposition, 'eligible', 'The document fixture must use a nonblocked candidate.');
    const pages = fixtures.document.pages.map((page) => ({ ...page, charCount: page.text.length }));
    const chunks = chunkPages(pages, fixtures.document.maxChunkChars);
    assert.equal(chunks.length, 3, 'The three readable fixture pages should produce three source-mapped chunks.');
    assert.deepEqual(chunks.map((chunk) => [chunk.startPage, chunk.endPage]), [[1, 1], [2, 2], [3, 3]]);
    return {
        scope: 'Partial first-demo rehearsal using synthetic fixtures; no live API, PDF upload, AI, or database calls.',
        asOfDate: fixtures.asOfDate,
        profileVersion: fixtures.profile.version,
        screeningCasesPassed: results.length,
        results,
        chunks,
    };
}

if (require.main === module) {
    const args = process.argv.slice(2);
    if (args.some((arg) => arg !== '--json') || args.length > 1) {
        console.error('Usage: node packages/server/src/scripts/rehearseFirstDemo.js [--json]');
        process.exitCode = 1;
    } else {
        const result = rehearseFirstDemo();
        if (args.includes('--json')) {
            console.log(JSON.stringify(result, null, 2));
        } else {
            console.log(result.scope);
            console.log(`Screening date: ${result.asOfDate}; profile version: ${result.profileVersion}`);
            console.table(result.results.map((item) => ({
                case: item.name,
                disposition: item.disposition,
                blockers: item.blockers.map((blocker) => blocker.code).join(', ') || 'none',
                check: 'PASS',
            })));
            console.table(result.chunks.map((chunk) => ({
                chunk: chunk.chunkIndex, startPage: chunk.startPage, endPage: chunk.endPage, characters: chunk.charCount,
            })));
            console.log(`PASS: ${result.screeningCasesPassed} screening cases and ${result.chunks.length} source-mapped chunks.`);
        }
    }
}

module.exports = { rehearseFirstDemo };
