const express = require('express');
const { randomUUID } = require('crypto');
const { knex, getUser } = require('../db');
const { getProfile, putProfile } = require('../db/organizationProfiles');
const { validateProfile } = require('../lib/complianceProfile');
const { profileEnabled } = require('../lib/complianceConfig');

const router = express.Router({ mergeParams: true });

function sendError(req, res, status, code, message, details = [], retryable = false) {
    return res.status(status).json({
        error: {
            code, message, retryable, requestId: req.complianceRequestId, details,
        },
    });
}

router.use((req, res, next) => {
    req.complianceRequestId = randomUUID();
    next();
});

router.use(async (req, res, next) => {
    const userId = req.signedCookies && req.signedCookies.userId;
    if (!userId) return sendError(req, res, 403, 'FORBIDDEN', 'You do not have access to this organization.');
    const user = await getUser(userId);
    if (!user) return sendError(req, res, 403, 'FORBIDDEN', 'You do not have access to this organization.');
    if (!['admin', 'staff'].includes(user.role_name)) {
        return sendError(req, res, 403, 'FORBIDDEN', 'You do not have access to this organization.');
    }

    const organizationId = Number(req.params.organizationId);
    if (!Number.isSafeInteger(organizationId) || organizationId < 0) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The organization ID is invalid.', [
            { field: 'organizationId', issue: 'must be a nonnegative integer' },
        ]);
    }
    if (user.role_name === 'staff' && user.agency_id !== organizationId) {
        return sendError(req, res, 403, 'FORBIDDEN', 'You do not have access to this organization.');
    }
    const agency = await knex('agencies').select('id', 'tenant_id')
        .where({ id: organizationId, tenant_id: user.tenant_id }).first();
    if (!agency) return sendError(req, res, 404, 'NOT_FOUND', 'The organization was not found.');

    req.complianceProfileAccess = { organizationId, tenantId: user.tenant_id, userId: user.id };
    return next();
});

router.use((req, res, next) => {
    if (!profileEnabled()) {
        return sendError(req, res, 404, 'FEATURE_DISABLED', 'This feature is not currently available.');
    }
    return next();
});

router.get('/', async (req, res) => {
    const { organizationId, tenantId } = req.complianceProfileAccess;
    const profile = await getProfile(organizationId, tenantId);
    if (!profile) return sendError(req, res, 404, 'NOT_FOUND', 'The organization profile was not found.');
    return res.json({ profile });
});

router.put('/', async (req, res) => {
    const details = validateProfile(req.body);
    if (details.length) return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', details);
    const { organizationId, tenantId, userId } = req.complianceProfileAccess;
    const profile = await putProfile(organizationId, tenantId, userId, req.body);
    if (!profile) return sendError(req, res, 409, 'VERSION_CONFLICT', 'The profile changed. Reload it and try again.');
    return res.status(req.body.expectedVersion === 0 ? 201 : 200).json({ profile });
});

// eslint-disable-next-line no-unused-vars
router.use((err, req, res, next) => {
    if (req.log) {
        req.log.error({
            requestId: req.complianceRequestId,
            errorName: err.name,
            errorCode: err.code,
        }, 'Compliance profile request failed');
    }
    return sendError(req, res, 500, 'INTERNAL_ERROR', 'The request could not be completed.');
});

module.exports = router;
