const { failure } = require('../lib/matchRuns');

const TABLE = 'grant_match_runs';
const GRANT_FIELDS = [
    'grant_id', 'revision_id', 'title', 'description', 'opportunity_status', 'close_date',
    'close_date_explanation', 'eligibility_codes', 'cost_sharing', 'raw_body_json',
];

function storedProfile(row) {
    return {
        id: row.id,
        organizationId: row.organization_id,
        version: row.version,
        jurisdiction: row.jurisdiction,
        population: row.population,
        focusAreas: row.focus_areas,
        staffingCapacity: row.staffing_capacity,
        matchingFunds: row.matching_funds,
    };
}

function serializeRun(row) {
    if (!row) return null;
    return {
        id: row.id,
        organizationId: row.organization_id,
        profileId: row.profile_id,
        profileVersion: row.profile_version,
        kind: 'grantMatching',
        subjectType: 'organizationProfile',
        subjectId: row.profile_id,
        status: row.status,
        progressPercent: 100,
        reviewRequired: row.status === 'reviewRequired',
        attempt: 1,
        parentRunId: null,
        methodVersion: row.result.methodVersion,
        model: row.result.model,
        promptVersion: null,
        createdBy: row.created_by,
        createdAt: row.created_at,
        startedAt: row.started_at,
        completedAt: row.completed_at,
        error: null,
        result: row.result,
    };
}

function createMatchRunRepository(knex) {
    const scope = (access) => ({ organization_id: access.organizationId, tenant_id: access.tenantId });
    return {
        findOrganization: (organizationId, tenantId) => knex('agencies').select('id')
            .where({ id: organizationId, tenant_id: tenantId }).first(),
        async loadInputs(access, request) {
            return knex.transaction(async (trx) => {
                await trx.raw('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY');
                const row = await trx('organization_profiles').where({ ...scope(access), id: request.profileId }).first();
                if (!row) throw failure('NOT_FOUND', 'The saved profile was not found.');
                if (row.version !== request.profileVersion) throw failure('VERSION_CONFLICT', 'The saved profile changed. Reload it before matching.');
                const candidates = trx('grants').select(GRANT_FIELDS);
                if (request.candidateGrantIds) candidates.whereIn('grant_id', request.candidateGrantIds.map(String));
                else candidates.whereIn('opportunity_status', ['posted', 'forecasted']);
                const { total } = await candidates.clone().clearSelect().count('* as total').first();
                const rows = await candidates.orderBy('grant_id', 'asc').limit(request.limit);
                if (request.candidateGrantIds && rows.length !== request.candidateGrantIds.length) {
                    throw failure('NOT_FOUND', 'One or more requested grants were not found.');
                }
                return {
                    profile: storedProfile(row),
                    rows,
                    selection: {
                        strategy: request.candidateGrantIds ? 'explicit-stored-grant-ids' : 'stored-current-id-ascending',
                        limit: request.limit,
                        totalAvailable: Number(total),
                        selectedCount: rows.length,
                        limited: Number(total) > rows.length,
                    },
                };
            });
        },
        async save(access, request, completed) {
            return knex.transaction(async (trx) => {
                // A profile edited during inference must not be saved as a fresh match for its old version.
                const profile = await trx('organization_profiles')
                    .where({ ...scope(access), id: request.profileId }).forShare().first();
                if (!profile) throw failure('NOT_FOUND', 'The saved profile was not found.');
                if (profile.version !== request.profileVersion) throw failure('VERSION_CONFLICT', 'The saved profile changed. Reload it before matching.');
                const [row] = await trx(TABLE).insert({
                    ...scope(access),
                    profile_id: profile.id,
                    profile_version: profile.version,
                    created_by: access.userId,
                    status: completed.status,
                    started_at: completed.startedAt,
                    completed_at: completed.completedAt,
                    input_snapshot: JSON.stringify(completed.inputs),
                    result: JSON.stringify(completed.result),
                }).returning('*');
                return serializeRun(row);
            });
        },
        async get(access, runId) {
            return serializeRun(await knex(TABLE).where({ ...scope(access), id: runId }).first());
        },
    };
}

module.exports = { createMatchRunRepository, serializeRun };
