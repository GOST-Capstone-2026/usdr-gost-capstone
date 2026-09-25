/**
 * F1 — Grant Analysis and Compliance Checklist subsystem (AN-06).
 * Marks pages that have too little text to be trusted (scans, image-only pages), so checklist items
 * that cite one of these pages can be flagged later.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.alterTable('grant_document_pages', (table) => {
        table.boolean('is_low_text').notNullable().defaultTo(false);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable('grant_document_pages', (table) => {
        table.dropColumn('is_low_text');
    });
};
