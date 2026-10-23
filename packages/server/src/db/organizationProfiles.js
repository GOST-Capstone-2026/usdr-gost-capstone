const knex = require('./connection');

const TABLE = 'organization_profiles';

function formatProfile(row) {
    if (!row) return null;
    return {
        id: row.id,
        organizationId: row.organization_id,
        version: row.version,
        jurisdiction: row.jurisdiction,
        population: row.population,
        focusAreas: row.focus_areas,
        staffingCapacity: row.staffing_capacity,
        matchingFunds: row.matching_funds,
        createdBy: row.created_by,
        updatedBy: row.updated_by,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
    };
}

async function getProfile(organizationId, tenantId) {
    const row = await knex(TABLE).where({ organization_id: organizationId, tenant_id: tenantId }).first();
    return formatProfile(row);
}

async function putProfile(organizationId, tenantId, userId, body) {
    const values = {
        jurisdiction: JSON.stringify(body.jurisdiction),
        population: body.population,
        focus_areas: JSON.stringify(body.focusAreas),
        staffing_capacity: JSON.stringify(body.staffingCapacity),
        matching_funds: JSON.stringify(body.matchingFunds),
        updated_by: userId,
        updated_at: knex.fn.now(),
    };
    if (body.expectedVersion === 0) {
        const inserted = await knex(TABLE).insert({
            ...values,
            organization_id: organizationId,
            tenant_id: tenantId,
            version: 1,
            created_by: userId,
        }).onConflict('organization_id').ignore()
            .returning('*');
        return inserted.length ? formatProfile(inserted[0]) : null;
    }
    const updated = await knex(TABLE)
        .where({ organization_id: organizationId, tenant_id: tenantId, version: body.expectedVersion })
        .update({ ...values, version: body.expectedVersion + 1 })
        .returning('*');
    return updated.length ? formatProfile(updated[0]) : null;
}

module.exports = { getProfile, putProfile };
