/**
 * F1 — Grant Analysis and Compliance Checklist subsystem (AN-08).
 * Records how many chunks a completed analysis run produced (AN-07's chunkPages), so the number
 * can be shown back to a user instead of only ever going into a server log.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.alterTable('analysis_runs', (table) => {
        table.integer('chunk_count');
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable('analysis_runs', (table) => {
        table.dropColumn('chunk_count');
    });
};
