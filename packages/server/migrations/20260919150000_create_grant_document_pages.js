/**
 * F1 — Grant Analysis and Compliance Checklist subsystem (AN-05).
 * One row per page of an uploaded grant notice, so checklist items can cite an exact
 * one-based page number and quote (Source Traceability Contract, docs/g32-shared-api-contracts.md).
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.createTable('grant_document_pages', (table) => {
        table.increments('id').primary();
        table.integer('document_id').unsigned().notNullable();
        // One-based, matching the page number a person sees in the PDF.
        table.integer('page_number').notNullable();
        table.text('text').notNullable();
        // Trimmed text length; AN-06 uses it to spot scanned or degraded pages.
        table.integer('char_count').notNullable();

        table.foreign('document_id').references('id').inTable('grant_documents').onDelete('CASCADE');
        table.unique(['document_id', 'page_number'], 'idx_grant_document_pages_doc_page');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.dropTable('grant_document_pages');
};
