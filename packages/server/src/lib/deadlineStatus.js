const { DateTime } = require('luxon');

const TIME_ZONE = 'America/New_York';
const DUE_SOON_WINDOW_DAYS = 7;
const PORTFOLIO_STATUSES = ['overdue', 'dueToday', 'dueSoon', 'upcoming', 'completed', 'completedLate', 'notApplicable'];
const REVIEW_NEEDED_STATUSES = [...PORTFOLIO_STATUSES.map((status) => `${status}Unverified`), 'reviewNeeded'];
const ALLOWED_STATUSES = [...PORTFOLIO_STATUSES, ...REVIEW_NEEDED_STATUSES];

function getToday(now = DateTime.now()) {
    return now.setZone(TIME_ZONE).startOf('day');
}

function computeDateStatus({
    completionStatus, completedAt, dueDate, today, dueSoonWindowDays,
}) {
    const due = DateTime.fromISO(dueDate, { zone: TIME_ZONE }).startOf('day');

    if (completionStatus === 'notApplicable') {
        return 'notApplicable';
    }

    if (completionStatus === 'completed') {
        const completedDay = completedAt
            ? DateTime.fromJSDate(completedAt).setZone(TIME_ZONE).startOf('day')
            : null;
        return completedDay && completedDay > due ? 'completedLate' : 'completed';
    }

    const dueSoonCutoff = today.plus({ days: dueSoonWindowDays });

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

function computeStatus(row, today, dueSoonWindowDays = DUE_SOON_WINDOW_DAYS) {
    if (row.due_date === null) {
        return 'reviewNeeded';
    }

    const dateStatus = computeDateStatus({
        completionStatus: row.completion_status,
        completedAt: row.completed_at,
        dueDate: row.due_date,
        today,
        dueSoonWindowDays,
    });

    return isPortfolioItem(row) ? dateStatus : `${dateStatus}Unverified`;
}

module.exports = {
    TIME_ZONE,
    DUE_SOON_WINDOW_DAYS,
    PORTFOLIO_STATUSES,
    REVIEW_NEEDED_STATUSES,
    ALLOWED_STATUSES,
    getToday,
    isPortfolioItem,
    computeStatus,
};
