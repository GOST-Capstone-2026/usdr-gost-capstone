/**
 * F1 — Grant Analysis and Compliance Checklist subsystem (AN-12).
 * One row per compliance obligation identified in a grant document, matching
 * docs/g32-shared-api-contracts.md, "Checklist Contract". AN-11's checklistItemSchema.js
 * defines this same shape before it is persisted; AN-14 is what actually fills these rows in
 * from the AI adapter's output.
 *
 * This is deliberately separate from the pre-existing `checklist_items_placeholder` table
 * (Manuel's M-01, keyed on agency_id, built so the deadline tracker could develop before this
 * subsystem existed). That table is untouched here; Manuel switches the deadline tracker over
 * to this real table once it has data in it.
 *
 * Organization and grant are reached through `document_id`, not duplicated on this table, the
 * same choice `grant_briefs` already made for the same reason.
 *
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = (knex) => knex.schema.createTable('checklist_items', (table) => {
    table.increments('id').primary();
    table.integer('document_id').unsigned().notNullable()
        .references('id')
        .inTable('grant_documents')
        .onDelete('CASCADE');

    table.text('category').notNullable();
    table.text('description').notNullable();
    table.boolean('found').notNullable();
    table.jsonb('sources').notNullable();
    table.boolean('possibly_affected_by_quality_issue').notNullable().defaultTo(false);
    table.date('due_date');

    table.text('completion_status').notNullable().defaultTo('notStarted');
    // Set when completion_status becomes 'completed', cleared when it moves away from that value
    // (Checklist Update Request rules), so the deadline tracker can tell completed obligations
    // apart from ones still open without re-deriving it from completion_status history.
    table.timestamp('completed_at', { useTz: true });
    table.text('user_notes');
    table.boolean('is_user_edited').notNullable().defaultTo(false);

    table.text('verification_status').notNullable().defaultTo('unverified');
    table.integer('verified_by').unsigned()
        .references('id')
        .inTable('users');
    table.timestamp('verified_at', { useTz: true });

    // Optimistic locking: a PATCH must send the version it last read, so two people editing the
    // same item at once get a conflict instead of one silently overwriting the other.
    table.integer('version').notNullable().defaultTo(1);

    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());

    table.index(['document_id']);
});

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = (knex) => knex.schema.dropTable('checklist_items');
