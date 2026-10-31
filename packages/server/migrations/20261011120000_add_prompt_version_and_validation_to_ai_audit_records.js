// the proposal (section 6.5) says audit records keep the prompt version and the
// validation result too. both are nullable so the rows written before this still fit.
//
// prompt_version    - which version of a prompt template was used, e.g. grant_summary_v1
// validation_status - did the model output pass the caller's structure check.
//                     null = the caller didn't check anything

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    await knex.schema.alterTable('ai_audit_records', (table) => {
        table.text('prompt_version');
        table.text('validation_status');
    });
    await knex.raw(`
        ALTER TABLE ai_audit_records
        ADD CONSTRAINT ai_audit_records_validation_status_check
        CHECK (validation_status IN ('passed', 'failed'))
    `);
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    await knex.raw('ALTER TABLE ai_audit_records DROP CONSTRAINT IF EXISTS ai_audit_records_validation_status_check');
    await knex.schema.alterTable('ai_audit_records', (table) => {
        table.dropColumn('prompt_version');
        table.dropColumn('validation_status');
    });
};
