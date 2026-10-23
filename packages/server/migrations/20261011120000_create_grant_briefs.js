/**
 * F1 — Grant Analysis and Compliance Checklist subsystem (AN-09).
 * One row per grant-brief result, matching docs/g32-shared-api-contracts.md, "Grant Brief
 * Contract". AN-10 fills these fields in from the AI adapter's output; this table only defines
 * where a brief lives once one exists.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => knex.schema.createTable('grant_briefs', (table) => {
    table.increments('id').primary();
    table.integer('document_id').unsigned().notNullable()
        .references('id')
        .inTable('grant_documents')
        .onDelete('CASCADE');
    // Which analysis run produced this brief, so it is clear which extraction/chunking pass the
    // AI call was based on. Nullable: a brief can outlive the run that first produced it.
    table.integer('run_id').unsigned()
        .references('id')
        .inTable('analysis_runs')
        .onDelete('SET NULL');

    table.jsonb('purpose').notNullable();
    table.jsonb('eligibility').notNullable();
    table.jsonb('funding_range').notNullable();
    table.jsonb('key_dates').notNullable();
    table.jsonb('cost_share').notNullable();
    table.jsonb('key_requirements').notNullable();
    table.jsonb('not_found_fields').notNullable();

    table.text('verification_status').notNullable().defaultTo('unverified');
    table.text('model');
    table.text('prompt_version');
    table.timestamp('generated_at', { useTz: true });
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['document_id']);
});

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('grant_briefs');
