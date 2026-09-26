const express = require('express');
const { DateTime } = require('luxon');
const { requireUser } = require('../lib/access-helpers');
const db = require('../db');

const router = express.Router({ mergeParams: true });

const TIME_ZONE = 'America/New_York';
const DUE_SOON_WINDOW_DAYS = 7;
const ALLOWED_STATUSES = ['upcoming', 'dueSoon', 'overdue', 'completed'];
const DEFAULT_PER_PAGE = 25;

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


function computeStatus({ completionStatus, dueDate, today }) {
    if (completionStatus === 'completed' || completionStatus === 'notApplicable') {
        return 'completed';
    }

    const due = DateTime.fromISO(dueDate, { zone: TIME_ZONE }).startOf('day');
    const dueSoonCutoff = today.plus({ days: DUE_SOON_WINDOW_DAYS });

    if (due < today) {
        return 'overdue';
    }
    if (due <= dueSoonCutoff) {
        return 'dueSoon';
    }
    return 'upcoming';
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
// Returns verified checklist items with non-null due dates for the authenticated
// user's organization, each annotated with a real-time computed status.
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
    let items = rows.map((row) => serializeDeadline(row, computeStatus({
        completionStatus: row.completion_status,
        dueDate: row.due_date,
        today,
    })));

    if (status) {
        items = items.filter((item) => item.status === status);
    }

    const total = items.length;
    const lastPage = Math.max(1, Math.ceil(total / size));
    const start = (page - 1) * size;
    const pageItems = items.slice(start, start + size);

    return res.json({
        data: pageItems,
        pagination: {
            currentPage: page, perPage: size, total, lastPage,
        },
    });
});

module.exports = router;
