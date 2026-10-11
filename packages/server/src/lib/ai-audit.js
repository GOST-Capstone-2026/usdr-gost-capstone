// audit trail for ai processing (task A-10). anything that sends data to a model
// should call generateTextAudited() instead of generateText(), so every call leaves
// a row in ai_audit_records: who asked, for which grant, which model, did it work,
// how many tokens. the prompt and output are stored as sha256 hashes only.

const crypto = require('crypto');
const { getAiProvider } = require('./ai-provider');
const { createLogger } = require('./logging');

const log = createLogger({ name: 'ai-audit' });

const TABLE = 'ai_audit_records';

const sha256 = (text) => crypto.createHash('sha256').update(text, 'utf8').digest('hex');

// the system prompt changes what the model does, so it's part of what gets hashed
function hashPrompt({ system, prompt }) {
    return sha256(JSON.stringify({ system: system || null, prompt: prompt || '' }));
}

// turns one finished (or failed) call into a row for ai_audit_records
function buildAuditRecord({
    requestId, context, args, provider, result, error, durationMs,
}) {
    const usage = (result && result.usage) || {};
    const record = {
        request_id: requestId,
        task: context.task,
        grant_id: context.grantId ?? null,
        user_id: context.userId ?? null,
        tenant_id: context.tenantId ?? null,
        provider: (result && result.provider) || provider.name,
        model: (result && result.model) || provider.model,
        status: error ? 'error' : 'success',
        error_code: error ? (error.code || 'unknown') : null,
        finish_reason: result ? result.finishReason : null,
        truncated: result ? result.truncated : null,
        duration_ms: durationMs,
        input_tokens: usage.inputTokens ?? null,
        output_tokens: usage.outputTokens ?? null,
        total_tokens: usage.totalTokens ?? null,
        prompt_sha256: hashPrompt(args),
        prompt_chars: (args.prompt || '').length,
        output_sha256: result ? sha256(result.text) : null,
        output_chars: result ? result.text.length : null,
    };
    return record;
}

// a broken audit table shouldn't take the feature down with it, so a failed write
// is logged loudly instead of thrown. returns the saved row id, or null if it didn't save
async function saveAuditRecord(knex, record) {
    try {
        const [row] = await knex(TABLE).insert(record).returning('id');
        return row.id;
    } catch (err) {
        log.error({ err, requestId: record.request_id, task: record.task }, 'failed to write ai audit record');
        return null;
    }
}

/**
 * Runs one ai call and records it. Same args and return value as generateText(),
 * plus an `audit` field with the request id and saved row id.
 * Provider errors are recorded and then rethrown, so callers handle them the same way as before.
 *
 * @param { { task: string, grantId?: string, userId?: number, tenantId?: number } } context what the call is for
 * @param { { prompt: string, system?: string, maxOutputTokens?: number, temperature?: number } } args
 * @param { { knex: import('knex').Knex, provider?: object, now?: () => number } } deps
 */
async function generateTextAudited(context, args, { knex, provider = getAiProvider(), now = Date.now } = {}) {
    if (!context || !context.task) throw new Error('audit context needs a task');
    if (!knex) throw new Error('generateTextAudited needs a knex instance');

    const requestId = crypto.randomUUID();
    const started = now();
    let result;
    let error;
    try {
        result = await provider.generateText(args);
    } catch (err) {
        error = err;
    }

    const record = buildAuditRecord({
        requestId, context, args: args || {}, provider, result, error, durationMs: now() - started,
    });
    const auditId = await saveAuditRecord(knex, record);

    if (error) throw error;
    return { ...result, audit: { requestId, id: auditId } };
}

/**
 * Reads audit rows back, newest first.
 * @param { import('knex').Knex } knex
 * @param { { grantId?: string, tenantId?: number, status?: string, limit?: number } } filters
 */
async function listAiAuditRecords(knex, {
    grantId, tenantId, status, limit = 50,
} = {}) {
    const query = knex(TABLE).select('*').orderBy('id', 'desc').limit(limit);
    if (grantId) query.where({ grant_id: grantId });
    if (tenantId) query.where({ tenant_id: tenantId });
    if (status) query.where({ status });
    return query;
}

module.exports = {
    buildAuditRecord,
    generateTextAudited,
    hashPrompt,
    listAiAuditRecords,
};
