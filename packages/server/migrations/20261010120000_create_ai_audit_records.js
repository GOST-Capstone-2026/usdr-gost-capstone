// one row per ai call, written whether the call worked or not.
// stores who/what/when + hashes of the prompt and output, never the text itself
// (same rule as the adapter logs, see docs/secrets-and-configuration.md).
//
// no foreign keys on purpose. an audit trail has to outlive the things it points at,
// so deleting a grant or user must not delete or block on its audit rows.

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.createTable('ai_audit_records', (table) => {
        table.bigIncrements('id').primary();
        table.uuid('request_id').notNullable().unique();
        table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

        // what the call was for, e.g. grant_summary
        table.text('task').notNullable();
        table.text('grant_id');
        table.integer('user_id');
        table.integer('tenant_id');

        table.text('provider').notNullable();
        table.text('model').notNullable();

        table.text('status').notNullable();
        table.text('error_code');
        table.text('finish_reason');
        table.boolean('truncated');
        table.integer('duration_ms').notNullable();

        table.integer('input_tokens');
        table.integer('output_tokens');
        table.integer('total_tokens');

        // sha256 lets us prove what was sent/returned without keeping the content
        table.text('prompt_sha256').notNullable();
        table.integer('prompt_chars').notNullable();
        table.text('output_sha256');
        table.integer('output_chars');

        table.index('created_at');
        table.index('grant_id');
        table.index(['tenant_id', 'created_at']);
    });
    await knex.raw(`
        ALTER TABLE ai_audit_records
        ADD CONSTRAINT ai_audit_records_status_check CHECK (status IN ('success', 'error'))
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.schema.dropTableIfExists('ai_audit_records');
};
