/**
 * F1 — Grant Analysis and Compliance Checklist subsystem (AN-08).
 * One row per attempt to process an uploaded document (extract text, rate quality, chunk for the
 * AI step). Upload only stores the file; this table lets the analysis-runs contract
 * (docs/g32-shared-api-contracts.md, Grant Document Contract) report progress so a client can
 * poll instead of waiting on the upload request itself.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('analysis_runs', (table) => {
        table.increments('id').primary();
        table.integer('document_id').unsigned().notNullable();
        // queued | processing | completed | failed
        table.text('status').notNullable().defaultTo('queued');
        table.text('error_message');

        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('started_at');
        table.timestamp('completed_at');

        table.foreign('document_id').references('id').inTable('grant_documents').onDelete('CASCADE');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTable('analysis_runs');
};
