const express = require('express');
const { DateTime } = require('luxon');
const { requireUser } = require('../lib/access-helpers');
const db = require('../db');

const router = express.Router({ mergeParams: true });

const TIME_ZONE = 'America/New_York';
const DUE_SOON_WINDOW_DAYS = 7;
const PORTFOLIO_STATUSES = ['overdue', 'dueToday', 'dueSoon', 'upcoming', 'completed', 'completedLate'];
const REVIEW_NEEDED_STATUSES = [...PORTFOLIO_STATUSES.map((status) => `${status}Unverified`), 'reviewNeeded'];
const ALLOWED_STATUSES = [...PORTFOLIO_STATUSES, ...REVIEW_NEEDED_STATUSES];
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

function computeDateStatus({
    completionStatus, completedAt, dueDate, today,
}) {
    const due = DateTime.fromISO(dueDate, { zone: TIME_ZONE }).startOf('day');

    if (completionStatus === 'completed' || completionStatus === 'notApplicable') {
        const completedDay = completedAt
            ? DateTime.fromJSDate(completedAt).setZone(TIME_ZONE).startOf('day')
            : null;
        return completedDay && completedDay > due ? 'completedLate' : 'completed';
    }

    const dueSoonCutoff = today.plus({ days: DUE_SOON_WINDOW_DAYS });

    if (due < today) {
        return 'overdue';
    }
    if (due.hasSame(today, 'day')) {
        return 'dueToday';
    }
    if (due <= dueSoonCutoff) {
        return 'dueSoon';
    }
    return 'upcoming';
}

function isPortfolioItem(row) {
    return row.verification_status === 'verified' && row.due_date !== null;
}

function computeStatus(row, today) {
    if (row.due_date === null) {
        return 'reviewNeeded';
    }

    const dateStatus = computeDateStatus({
        completionStatus: row.completion_status,
        completedAt: row.completed_at,
        dueDate: row.due_date,
        today,
    });

    return isPortfolioItem(row) ? dateStatus : `${dateStatus}Unverified`;
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

function serializeDeadline(row, status) {
    return {
        checklistItemId: row.id,
        grantId: null,
        documentId: null,
        title: row.description,
        dueDate: row.due_date,
        status,
        completionStatus: row.completion_status,
        completedAt: toIsoOrNull(row.completed_at),
        verificationStatus: row.verification_status,
        verifiedBy: row.verified_by,
        verifiedAt: toIsoOrNull(row.verified_at),
        source: null,
    };
}

// GET /api/organizations/:organizationId/compliance/deadlines
// Returns the authenticated user's organization's deadline items in two groups:
// portfolio (verified and dated) and reviewNeeded (unverified or undated), each
// annotated with a real-time computed status. Rejected items are excluded.
router.get('/deadlines', requireUser, async (req, res) => {
    const { selectedAgency } = req.session;
    const {
        from, through, status, currentPage, perPage,
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

    const rows = await db.getDeadlineChecklistItems({ agencyId: selectedAgency, from, through });

    const today = DateTime.now().setZone(TIME_ZONE).startOf('day');

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

    const today = DateTime.now().setZone(TIME_ZONE).startOf('day');
    const deadline = serializeDeadline(updated, computeStatus(updated, today));

    return res.json({ deadline });
});

module.exports = router;
