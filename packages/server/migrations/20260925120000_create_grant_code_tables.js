// one table per list field that used to be jammed into a string column on grants.
// key is the table name, value is the old column + the regex it was joined with.
const CODE_TABLES = {
    grants_cfda_numbers: { column: 'cfda_list', separator: ',\\s*' },
    grants_eligibility_codes: { column: 'eligibility_codes', separator: '\\s+' },
    grants_funding_instrument_codes: { column: 'funding_instrument_codes', separator: '\\s+' },
    grants_funding_activity_category_codes: { column: 'funding_activity_category_codes', separator: '\\s+' },
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.up = async function (knex) {
    for (const [tableName, { column, separator }] of Object.entries(CODE_TABLES)) {
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.createTable(tableName, (table) => {
            table.text('grant_id').notNullable();
            table.text('code').notNullable();

            table.foreign('grant_id').references('grant_id').inTable('grants').onDelete('CASCADE');
            table.primary(['grant_id', 'code']);
            table.index('code');
        });

        // backfill from the existing string columns so old grants aren't missing codes
        // eslint-disable-next-line no-await-in-loop
        await knex.raw(`
            INSERT INTO ?? (grant_id, code)
            SELECT DISTINCT g.grant_id, trim(c.code)
            FROM grants g
            CROSS JOIN LATERAL regexp_split_to_table(g.??, ?) AS c(code)
            WHERE trim(c.code) <> ''
            ON CONFLICT DO NOTHING
        `, [tableName, column, separator]);
    }
};

/**
 * @param { import("knex").Knex } knex
 * @returns { Promise<void> }
 */
exports.down = async function (knex) {
    for (const tableName of Object.keys(CODE_TABLES)) {
        // eslint-disable-next-line no-await-in-loop
        await knex.schema.dropTableIfExists(tableName);
    }
};
