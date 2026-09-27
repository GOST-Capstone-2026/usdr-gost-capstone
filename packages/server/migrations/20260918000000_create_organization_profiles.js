exports.up = (knex) => knex.schema.createTable('organization_profiles', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').unsigned().notNullable().unique()
        .references('id')
        .inTable('agencies')
        .onDelete('CASCADE');
    table.integer('tenant_id').unsigned().notNullable()
        .references('id')
        .inTable('tenants');
    table.integer('version').unsigned().notNullable().defaultTo(1);
    table.jsonb('jurisdiction').notNullable();
    table.integer('population').unsigned().notNullable();
    table.jsonb('focus_areas').notNullable();
    table.jsonb('staffing_capacity').notNullable();
    table.jsonb('matching_funds').notNullable();
    table.integer('created_by').unsigned().notNullable()
        .references('id')
        .inTable('users');
    table.integer('updated_by').unsigned().notNullable()
        .references('id')
        .inTable('users');
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('updated_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.index(['tenant_id', 'organization_id']);
});

exports.down = (knex) => knex.schema.dropTable('organization_profiles');
