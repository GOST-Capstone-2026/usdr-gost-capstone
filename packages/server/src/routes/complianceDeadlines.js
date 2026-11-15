const express = require('express');
const { DateTime } = require('luxon');
const { requireUser } = require('../lib/access-helpers');
const { canVerifyFoundItem } = require('../lib/sourceCitationValidation');
const {
    ALLOWED_STATUSES, getToday, isPortfolioItem, computeStatus,
} = require('../lib/deadlineStatus');
const db = require('../db');

const router = express.Router({ mergeParams: true });

const DEFAULT_PER_PAGE = 25;
const ALLOWED_COMPLETION_STATUSES = ['notStarted', 'inProgress', 'completed', 'notApplicable'];
const ALLOWED_PATCH_FIELDS = ['dueDate', 'completionStatus'];
const ISO_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

function sendError(req, res, status, code, message, details) {
    return res.status(status).json({
        error: {
            code,
            message,
            retryable: status >= 500,
            requestId: req.id,
            details: details || [],
        },
    });
}

function paginate(items, page, size) {
    const total = items.length;
    const start = (page - 1) * size;
    return {
        items: items.slice(start, start + size),
        pagination: {
            currentPage: page, perPage: size, total, lastPage: Math.max(1, Math.ceil(total / size)),
        },
    };
}

function toIsoOrNull(dateValue) {
    return dateValue ? DateTime.fromJSDate(dateValue).toUTC().toISO() : null;
}

function hasReadableSources(sources) {
    return Array.isArray(sources) && sources.length > 0 && sources.every((source) => (
        Number.isInteger(source?.pageNumber) && source.pageNumber > 0 && typeof source.excerpt === 'string' && source.excerpt.trim()
    ));
}

function serializeDeadline(row, status) {
    const first = Array.isArray(row.sources) ? row.sources[0] : null;
    const sources = hasReadableSources(row.sources)
        ? row.sources.map(({ pageNumber, excerpt }) => ({ pageNumber, excerpt }))
        : [];
    return {
        checklistItemId: row.id,
        grantId: row.grant_id,
        documentId: row.document_id,
        title: row.description,
        dueDate: row.due_date,
        status,
        completionStatus: row.completion_status,
        completedAt: toIsoOrNull(row.completed_at),
        verificationStatus: row.verification_status,
        verifiedBy: row.verified_by,
        verifiedAt: toIsoOrNull(row.verified_at),
        version: row.version,
        source: first?.pageNumber == null || first.excerpt == null
            ? null : { pageNumber: first.pageNumber, excerpt: first.excerpt },
        sources,
    };
}

// GET /api/organizations/:organizationId/compliance/deadlines
// Returns the authenticated user's organization's deadline items in two groups:
// portfolio (verified and dated) and reviewNeeded (unverified or undated), each
// annotated with a real-time computed status. Rejected items are excluded.
router.get('/deadlines', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
    const {
        from, through, status, currentPage, perPage, documentId,
    } = req.query;

    if (status && !ALLOWED_STATUSES.includes(status)) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
            { field: 'status', issue: `must be one of ${ALLOWED_STATUSES.join(', ')}` },
        ]);
    }

    const page = currentPage ? Number(currentPage) : 1;
    const size = perPage ? Number(perPage) : DEFAULT_PER_PAGE;

    if (!Number.isInteger(page) || page < 1) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
            { field: 'currentPage', issue: 'must be a positive integer' },
        ]);
    }
    if (!Number.isInteger(size) || size < 1) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
            { field: 'perPage', issue: 'must be a positive integer' },
        ]);
    }

    let document;
    if (documentId !== undefined) {
        if (typeof documentId !== 'string' || !/^[1-9]\d*$/.test(documentId) || Number(documentId) > 2147483647) {
            return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
                { field: 'documentId', issue: 'must be a positive document ID' },
            ]);
        }
        document = await db.getGrantDocument({ documentId: Number(documentId), agencyId: selectedAgency });
        if (!document) {
            return sendError(req, res, 404, 'NOT_FOUND', 'Document not found.');
        }
    }

    const rows = await db.getDeadlineChecklistItems({
        agencyId: selectedAgency, from, through, documentId: document?.id,
    });

    const today = getToday();

    // Status is computed in application code, not SQL
    const portfolioItems = [];
    const reviewNeededItems = [];
    rows.forEach((row) => {
        const item = serializeDeadline(row, computeStatus(row, today));
        if (status && item.status !== status) {
            return;
        }
        (isPortfolioItem(row) ? portfolioItems : reviewNeededItems).push(item);
    });

    const portfolio = paginate(portfolioItems, page, size);
    const reviewNeeded = paginate(reviewNeededItems, page, size);

    return res.json({
        ...(document && { document: { id: document.id, grantId: document.grant_id } }),
        data: {
            portfolio: portfolio.items,
            reviewNeeded: reviewNeeded.items,
        },
        pagination: {
            portfolio: portfolio.pagination,
            reviewNeeded: reviewNeeded.pagination,
        },
    });
});

router.patch('/deadlines/:checklistItemId', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
    const checklistItemId = Number(req.params.checklistItemId);

    if (!Number.isInteger(checklistItemId) || checklistItemId < 1) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
            { field: 'checklistItemId', issue: 'must be a positive integer' },
        ]);
    }

    const body = req.body || {};
    const bodyFields = Object.keys(body);
    const unknownFields = bodyFields.filter((field) => !ALLOWED_PATCH_FIELDS.includes(field));

    if (unknownFields.length > 0) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', unknownFields.map((field) => ({ field, issue: 'unsupported field' })));
    }

    if (bodyFields.length === 0) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', [
            { field: 'body', issue: 'must include dueDate and/or completionStatus' },
        ]);
    }

    const { dueDate, completionStatus } = body;
    const details = [];

    if (dueDate !== undefined
        && (dueDate === null || typeof dueDate !== 'string' || !ISO_DATE_PATTERN.test(dueDate) || !DateTime.fromISO(dueDate).isValid)) {
        details.push({ field: 'dueDate', issue: 'must be a valid YYYY-MM-DD date' });
    }

    if (completionStatus !== undefined && !ALLOWED_COMPLETION_STATUSES.includes(completionStatus)) {
        details.push({ field: 'completionStatus', issue: `must be one of ${ALLOWED_COMPLETION_STATUSES.join(', ')}` });
    }

    if (details.length > 0) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'The request contains invalid fields.', details);
    }

    const updated = await db.updateDeadlineChecklistItem({
        id: checklistItemId,
        agencyId: selectedAgency,
        dueDate,
        completionStatus,
    });

    if (!updated) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Checklist item not found.');
    }

    const deadline = serializeDeadline(updated, computeStatus(updated, getToday()));

    return res.json({ deadline });
});

router.patch('/deadlines/:checklistItemId/verification', requireUser, async (req, res) => {
    const { selectedAgency, user } = req.session;
    if (!['admin', 'staff'].includes(user.role_name)) {
        return sendError(req, res, 403, 'FORBIDDEN', 'Only administrators and staff can verify a checklist item.');
    }

    const id = Number(req.params.checklistItemId);
    const { expectedVersion } = req.body || {};
    if (!/^[1-9]\d*$/.test(req.params.checklistItemId) || id > 2147483647
        || !Number.isInteger(expectedVersion) || expectedVersion < 1 || expectedVersion >= 2147483647
        || Object.keys(req.body || {}).length !== 1) {
        return sendError(req, res, 400, 'VALIDATION_ERROR', 'A checklist item ID and its current version are required.');
    }

    const item = await db.getDeadlineChecklistItem({ id, agencyId: selectedAgency });
    if (!item) {
        return sendError(req, res, 404, 'NOT_FOUND', 'Checklist item not found.');
    }
    if (item.version !== expectedVersion) {
        return sendError(req, res, 409, 'VERSION_CONFLICT', 'This item changed. Review the latest version before verifying.');
    }
    if (item.verification_status === 'verified') {
        return res.json({ deadline: serializeDeadline(item, computeStatus(item, getToday())) });
    }

    const { document_id: documentId } = item;
    const pages = await db.getGrantDocumentPages({ documentId, agencyId: selectedAgency });
    if (!hasReadableSources(item.sources) || !canVerifyFoundItem({ found: true, sources: item.sources }, pages, { expectedDocumentId: documentId })) {
        return sendError(req, res, 422, 'SOURCE_NOT_VERIFIABLE', 'The cited text could not be verified against the document.');
    }

    const updated = await db.updateChecklistItem({
        itemId: id,
        agencyId: selectedAgency,
        expectedVersion,
        verifiedByUserId: user.id,
        verificationStatus: 'verified',
    });
    if (!updated) {
        return sendError(req, res, 409, 'VERSION_CONFLICT', 'This item changed. Review the latest version before verifying.');
    }

    const row = { ...updated, grant_id: item.grant_id };
    return res.json({ deadline: serializeDeadline(row, computeStatus(row, getToday())) });
});

module.exports = router;
