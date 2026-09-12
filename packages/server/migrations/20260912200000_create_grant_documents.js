/**
 * F1 — Grant Analysis and Compliance Checklist subsystem.
 * One row per uploaded grant notice PDF. See docs/g32-shared-api-contracts.md
 * ("Grant Document Contract") for the API shape this table backs.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('grant_documents', (table) => {
        table.increments('id').primary();
        table.integer('agency_id').unsigned().notNullable();
        table.text('grant_id').notNullable();
        table.integer('uploaded_by').unsigned().notNullable();

        table.text('filename').notNullable();
        table.text('mime_type').notNullable();
        table.integer('size_bytes').notNullable();
        table.text('sha256').notNullable();
        table.integer('page_count');
        table.text('source_url');
        // unknown | readable | degraded | unreadable — set by the analysis worker (AN-06/AN-07), not at upload time
        table.text('extraction_quality').notNullable().defaultTo('unknown');

        // Where the PDF bytes actually live. Never returned to the browser.
        table.text('storage_bucket').notNullable();
        table.text('storage_key').notNullable();

        table.timestamp('uploaded_at').notNullable().defaultTo(knex.fn.now());

        table.foreign('agency_id').references('agencies.id');
        table.foreign('grant_id').references('grant_id').inTable('grants');
        table.foreign('uploaded_by').references('users.id');

        table.unique(['agency_id', 'sha256'], 'idx_grant_documents_agency_sha256');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTable('grant_documents');
};
