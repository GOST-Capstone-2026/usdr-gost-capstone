const express = require('express');
const { randomUUID } = require('crypto');

const ERRORS = {
    VALIDATION_ERROR: [400, 'The request contains invalid fields.', false],
    NOT_FOUND: [404, 'The requested profile, grants, or match run were not found.', false],
    VERSION_CONFLICT: [409, 'The saved profile changed. Reload it before matching.', false],
    PROFILE_FOCUS_REQUIRED: [422, 'Add a focus area to the saved profile before matching.', false],
    INVALID_PROFILE: [422, 'Review and save the organization profile before matching.', false],
    INPUT_TOO_LARGE: [422, 'A candidate listing exceeds the supported size limit.', false],
    INVALID_CANDIDATES: [422, 'The stored candidates cannot be processed. Ask the team to review the data.', false],
    DUPLICATE_CANDIDATE: [422, 'The stored candidates contain duplicate grant identities.', false],
    MATCHING_BUSY: [429, 'The local matcher is busy. Try again shortly.', true],
    MODEL_NOT_CACHED: [503, 'The pinned matching model is not prepared on this server.', false],
    MODEL_INTEGRITY_ERROR: [503, 'The matching model needs administrator attention.', false],
    MODEL_RUNTIME_MISMATCH: [503, 'The matching runtime needs administrator attention.', false],
    '42P01': [503, 'Match storage is not ready. Ask the team to apply the migration.', false],
};
const routeId = (value) => /^(0|[1-9]\d*)$/.test(value)
    && Number.isSafeInteger(Number(value)) && Number(value) <= 2147483647;
const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function createMatchRunsRouter({
    getUser, repository, runMatching, enabled,
}) {
    const router = express.Router({ mergeParams: true });
    const sendError = (req, res, status, code, message, retryable = false, details = []) => res.status(status).json({
        error: {
            code, message, retryable, requestId: req.matchRequestId, details,
        },
    });
    router.use((req, res, next) => {
        req.matchRequestId = randomUUID();
        res.set('Cache-Control', 'no-store');
        next();
    });
    router.use(asyncRoute(async (req, res, next) => {
        const userId = req.signedCookies?.userId;
        const user = userId ? await getUser(userId) : null;
        if (!user || !['admin', 'staff'].includes(user.role_name)) {
            return sendError(req, res, 403, 'FORBIDDEN', 'You do not have access to this organization.');
        }
        if (!routeId(req.params.organizationId)) {
            return sendError(req, res, 400, 'VALIDATION_ERROR', 'The organization ID is invalid.');
        }
        const organizationId = Number(req.params.organizationId);
        if (user.role_name === 'staff' && user.agency_id !== organizationId) {
            return sendError(req, res, 403, 'FORBIDDEN', 'You do not have access to this organization.');
        }
        if (!await repository.findOrganization(organizationId, user.tenant_id)) {
            return sendError(req, res, 404, 'NOT_FOUND', 'The organization was not found.');
        }
        if (!enabled()) return sendError(req, res, 404, 'FEATURE_DISABLED', 'Grant matching is not currently available.');
        req.matchAccess = { organizationId, tenantId: user.tenant_id, userId: user.id };
        return next();
    }));
    const response = (req, run) => ({
        run, links: { self: `/api/organizations/${req.matchAccess.organizationId}/compliance/match-runs/${run.id}` },
    });
    router.post('/', asyncRoute(async (req, res) => {
        const run = await runMatching(req.matchAccess, req.body);
        return res.status(201).json(response(req, run));
    }));
    router.get('/:runId', asyncRoute(async (req, res) => {
        if (!routeId(req.params.runId) || Number(req.params.runId) < 1) {
            return sendError(req, res, 400, 'VALIDATION_ERROR', 'The match run ID is invalid.');
        }
        const run = await repository.get(req.matchAccess, Number(req.params.runId));
        if (!run) return sendError(req, res, 404, 'NOT_FOUND', 'The match run was not found.');
        return res.json(response(req, run));
    }));
    // eslint-disable-next-line no-unused-vars
    router.use((error, req, res, next) => {
        const known = Object.prototype.hasOwnProperty.call(ERRORS, error.code);
        const [status, message, retryable] = known ? ERRORS[error.code] : [500, 'The match request could not be completed.', false];
        let code = known ? error.code : 'INTERNAL_ERROR';
        if (error.code === '42P01') code = 'MATCH_STORAGE_UNAVAILABLE';
        if (req.log) req.log.error({ requestId: req.matchRequestId, errorCode: code }, 'Match request failed');
        return sendError(req, res, status, code, message, retryable, error.code === 'VALIDATION_ERROR' ? error.details : []);
    });
    return router;
}

module.exports = { createMatchRunsRouter };
