exports.up = (knex) => knex.schema.createTable('grant_match_runs', (table) => {
    table.increments('id').primary();
    table.integer('organization_id').notNullable().references('id').inTable('agencies')
        .onDelete('CASCADE');
    table.integer('tenant_id').notNullable().references('id').inTable('tenants');
    table.integer('profile_id').notNullable().references('id').inTable('organization_profiles')
        .onDelete('CASCADE');
    table.integer('profile_version').notNullable();
    table.integer('created_by').nullable().references('id').inTable('users')
        .onDelete('SET NULL');
    table.enu('status', ['completed', 'reviewRequired']).notNullable();
    table.jsonb('input_snapshot').notNullable();
    table.jsonb('result').notNullable();
    table.timestamp('created_at', { useTz: true }).notNullable().defaultTo(knex.fn.now());
    table.timestamp('started_at', { useTz: true }).notNullable();
    table.timestamp('completed_at', { useTz: true }).notNullable();
    table.index(['tenant_id', 'organization_id', 'id']);
});

exports.down = (knex) => knex.schema.dropTable('grant_match_runs');
