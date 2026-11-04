exports.up = function (knex) {
    return knex.schema.dropTable('checklist_items_placeholder');
};

exports.down = function (knex) {
    return knex.schema.createTable('checklist_items_placeholder', (table) => {
        table.increments('id').primary();
        table.integer('agency_id').notNullable();
        table.text('category');
        table.text('description');
        table.date('due_date');
        table.text('completion_status').notNullable().defaultTo('open');
        table.timestamp('completed_at');
        table.text('verification_status').notNullable().defaultTo('unverified');
        table.integer('verified_by');
        table.timestamp('verified_at');
        table.boolean('is_user_edited').notNullable().defaultTo(false);
        table.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
        table.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
        table.integer('source_page_number');
        table.text('source_excerpt');

        table.foreign('agency_id').references('agencies.id');
    });
};
