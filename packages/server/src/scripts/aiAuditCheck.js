#!/usr/bin/env node
// end-to-end check for ai audit records (task A-10), using the demo grants from A-09.
// runs a few ai calls through generateTextAudited(), forces one failure, then reads
// the rows back out of ai_audit_records.
// usage: yarn ai:audit-check          (mock provider, free, no network)
//        yarn ai:audit-check --live   (one real call with whatever AI_PROVIDER is set to)
require('dotenv').config();
const knex = require('../db/connection');
const { AiProviderError, createAiProvider, getAiConfig } = require('../lib/ai-provider');
const { generateTextAudited, hashPrompt, listAiAuditRecords } = require('../lib/ai-audit');
const demoData = require('../../seeds/demo/opportunities.json');

const SYSTEM = 'You help state and local governments understand grant opportunities. Be concise.';
const live = process.argv.includes('--live');
let failures = 0;

function check(label, ok) {
    failures += ok ? 0 : 1;
    console.log(`  [${ok ? 'PASS' : 'FAIL'}] ${label}`);
}

async function main() {
    // mock unless --live, so running this never spends budget by accident
    const config = getAiConfig(live ? process.env : { ...process.env, AI_PROVIDER: 'mock' });
    const provider = createAiProvider(config);
    const demoIds = demoData.opportunities.map((o) => o.opportunity.id);
    const grants = await knex('grants')
        .select('grant_id', 'title', 'description')
        .whereIn('grant_id', demoIds)
        .orderBy('grant_id')
        .limit(live ? 1 : 3);
    if (grants.length === 0) throw new Error('no demo grants in the db, run "yarn demo:load" first');
    const [{ count: before }] = await knex('ai_audit_records').count();

    console.log(`\nstep 1: summarize ${grants.length} demo grant(s) with provider "${provider.name}"`);
    const prompts = {};
    for (const grant of grants) {
        prompts[grant.grant_id] = `Summarize this grant in two sentences.\n\nTitle: ${grant.title}\n\n${grant.description}`;
        // eslint-disable-next-line no-await-in-loop
        const result = await generateTextAudited(
            { task: 'grant_summary', grantId: grant.grant_id, tenantId: 1 },
            { system: SYSTEM, prompt: prompts[grant.grant_id] },
            { knex, provider },
        );
        console.log(`  grant ${grant.grant_id}: ok, audit record #${result.audit.id}`);
    }

    console.log('\nstep 2: force a failed call (fake provider that is out of budget)');
    const brokenProvider = {
        name: provider.name,
        model: provider.model,
        generateText: async () => { throw new AiProviderError('monthly budget exceeded', { code: 'budget', status: 402 }); },
    };
    let thrown = null;
    try {
        await generateTextAudited(
            { task: 'grant_summary', grantId: grants[0].grant_id, tenantId: 1 },
            { system: SYSTEM, prompt: prompts[grants[0].grant_id] },
            { knex, provider: brokenProvider },
        );
    } catch (err) {
        thrown = err;
    }
    console.log(`  call failed as expected: [${thrown && thrown.code}] ${thrown && thrown.message}`);

    console.log('\nstep 3: read the audit records back from the db');
    const expectedNew = grants.length + 1;
    const rows = (await listAiAuditRecords(knex, { limit: expectedNew })).reverse();
    console.table(rows.map((r) => ({
        id: Number(r.id),
        task: r.task,
        grant_id: r.grant_id,
        provider: r.provider,
        model: r.model,
        status: r.status,
        error_code: r.error_code,
        tokens: r.total_tokens,
        ms: r.duration_ms,
        prompt_chars: r.prompt_chars,
        prompt_sha256: `${r.prompt_sha256.slice(0, 12)}...`,
    })));

    const [{ count: after }] = await knex('ai_audit_records').count();
    const successes = rows.filter((r) => r.status === 'success');
    const errors = rows.filter((r) => r.status === 'error');
    const columns = Object.keys(await knex('ai_audit_records').columnInfo());
    check(`${expectedNew} new audit records were written`, Number(after) - Number(before) === expectedNew);
    check('every successful call has a record tied to its grant', successes.length === grants.length
        && successes.every((r) => demoIds.includes(r.grant_id)));
    check('the failed call was recorded with error_code "budget" and still rethrown', errors.length === 1
        && errors[0].error_code === 'budget' && thrown instanceof AiProviderError);
    check('stored hash matches the prompt that was sent', successes.every(
        (r) => r.prompt_sha256 === hashPrompt({ system: SYSTEM, prompt: prompts[r.grant_id] }),
    ));
    check('no column stores prompt or output text', !columns.some((c) => ['prompt', 'output', 'text', 'response'].includes(c))
        && rows.every((r) => !Object.values(r).some((v) => typeof v === 'string' && v.includes('Summarize this grant'))));
    check('every record has a unique request id', new Set(rows.map((r) => r.request_id)).size === rows.length);

    console.log(`\n${failures === 0 ? 'all checks passed' : `${failures} check(s) failed`}`);
    if (failures) process.exitCode = 1;
}

if (require.main === module) {
    main()
        .catch((err) => {
            // only print code + message, never the raw error object (could hold request details)
            console.error(`ai audit check failed [${err.code || 'error'}]: ${err.message}`);
            process.exitCode = 1;
        })
        .finally(() => knex.destroy());
}
