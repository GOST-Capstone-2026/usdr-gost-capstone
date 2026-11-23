/**
 * F1 — Grant Analysis and Compliance Checklist subsystem (AN-17 follow-up).
 * True when the most recent analysis run for this document did not get a usable response for
 * every chunk (an AI call failed, or came back unparseable) while synthesizing the brief or
 * generating checklist items. Lets a retry tell "fully processed, nothing more to do" apart from
 * "something was missed, try to fill it in", and lets the UI show that a result may be partial.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = function (knex) {
    return knex.schema.alterTable('grant_documents', (table) => {
        table.boolean('analysis_incomplete').notNullable().defaultTo(false);
    });
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = function (knex) {
    return knex.schema.alterTable('grant_documents', (table) => {
        table.dropColumn('analysis_incomplete');
    });
};
