#!/usr/bin/env node
// loads the first-demo opportunity set into the db (task A-09).
// goes through the same mapping + upsert the sqs consumer uses, so the demo grants
// look exactly like ingested ones and the normalized code tables get filled too.
// safe to rerun: same revision = skipped.
// usage: yarn demo:load
require('dotenv').config();
const knex = require('../db/connection');
const { mapSourceDataToCodes, mapSourceDataToGrant, upsertGrant } = require('../lib/grants-ingest');
const demoData = require('../../seeds/demo/opportunities.json');

async function loadDemoOpportunities(db, opportunities) {
    const results = [];
    for (const source of opportunities) {
        const grant = mapSourceDataToGrant(source);
        const codes = mapSourceDataToCodes(source);
        // eslint-disable-next-line no-await-in-loop
        const written = await upsertGrant(db, grant, codes);
        results.push({
            grant_id: grant.grant_id,
            result: written ? 'loaded' : 'skipped (already loaded)',
            status: grant.opportunity_status,
            close_date: grant.close_date,
            title: grant.title.slice(0, 50),
        });
    }
    return results;
}

async function main() {
    const { opportunities, fetched_on: fetchedOn, source } = demoData;
    console.log(`loading ${opportunities.length} demo opportunities (fetched ${fetchedOn} from ${source})`);

    const results = await loadDemoOpportunities(knex, opportunities);
    console.table(results);

    const ids = results.map((r) => r.grant_id);
    const [{ count }] = await knex('grants').whereIn('grant_id', ids).count();
    const loaded = results.filter((r) => r.result === 'loaded').length;
    console.log(`loaded: ${loaded} | skipped: ${results.length - loaded} | demo grants now in db: ${count} of ${ids.length}`);
    if (Number(count) !== ids.length) process.exitCode = 1;
}

if (require.main === module) {
    main()
        .catch((err) => {
            console.error('demo load failed:', err.message);
            process.exitCode = 1;
        })
        .finally(() => knex.destroy());
}

module.exports = { loadDemoOpportunities };
