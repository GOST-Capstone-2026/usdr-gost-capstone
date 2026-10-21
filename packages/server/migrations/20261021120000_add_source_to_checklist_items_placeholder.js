exports.up = function (knex) {
    return knex.schema.alterTable('checklist_items_placeholder', (table) => {
        table.integer('source_page_number');
        table.text('source_excerpt');
    });
};

exports.down = function (knex) {
    return knex.schema.alterTable('checklist_items_placeholder', (table) => {
        table.dropColumn('source_page_number');
        table.dropColumn('source_excerpt');
    });
};
