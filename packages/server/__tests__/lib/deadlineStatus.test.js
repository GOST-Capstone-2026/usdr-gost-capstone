const { expect } = require('chai');
const { DateTime } = require('luxon');
const {
    ALLOWED_STATUSES, DUE_SOON_WINDOW_DAYS, getToday, isPortfolioItem, computeStatus,
} = require('../../src/lib/deadlineStatus');

const TODAY = getToday(DateTime.fromISO('2026-10-20T16:00:00Z'));

function item(overrides = {}) {
    return {
        due_date: '2026-10-20',
        completion_status: 'notStarted',
        completed_at: null,
        verification_status: 'verified',
        ...overrides,
    };
}

function daysFromToday(days) {
    return TODAY.plus({ days }).toISODate();
}

describe('Deadline status module', () => {
    context('getToday', () => {
        it('uses the Eastern Time date when UTC has already moved to the next day', () => {
            const today = getToday(DateTime.fromISO('2026-10-21T02:00:00Z'));
            expect(today.toISODate()).to.equal('2026-10-20');
        });

        it('moves to the next day once midnight passes in Eastern Time', () => {
            const today = getToday(DateTime.fromISO('2026-10-21T04:30:00Z'));
            expect(today.toISODate()).to.equal('2026-10-21');
        });
    });

    context('computeStatus for incomplete items', () => {
        it('returns overdue for a due date before today', () => {
            expect(computeStatus(item({ due_date: daysFromToday(-1) }), TODAY)).to.equal('overdue');
        });

        it('returns dueToday for a due date of today', () => {
            expect(computeStatus(item({ due_date: daysFromToday(0) }), TODAY)).to.equal('dueToday');
        });

        it('returns dueSoon on the last day of the default window', () => {
            expect(computeStatus(item({ due_date: daysFromToday(DUE_SOON_WINDOW_DAYS) }), TODAY)).to.equal('dueSoon');
        });

        it('returns upcoming on the first day after the default window', () => {
            expect(computeStatus(item({ due_date: daysFromToday(DUE_SOON_WINDOW_DAYS + 1) }), TODAY)).to.equal('upcoming');
        });

        it('applies a custom due-soon window', () => {
            expect(computeStatus(item({ due_date: daysFromToday(3) }), TODAY, 3)).to.equal('dueSoon');
            expect(computeStatus(item({ due_date: daysFromToday(4) }), TODAY, 3)).to.equal('upcoming');
        });

        it('treats inProgress the same as notStarted', () => {
            expect(computeStatus(item({ due_date: daysFromToday(-1), completion_status: 'inProgress' }), TODAY)).to.equal('overdue');
        });
    });

    context('computeStatus for closed items', () => {
        it('returns completed when finished on the due date', () => {
            const row = item({ completion_status: 'completed', completed_at: new Date('2026-10-20T15:00:00Z') });
            expect(computeStatus(row, TODAY)).to.equal('completed');
        });

        it('returns completed when finished late in the evening Eastern Time on the due date', () => {
            const row = item({ completion_status: 'completed', completed_at: new Date('2026-10-21T02:00:00Z') });
            expect(computeStatus(row, TODAY)).to.equal('completed');
        });

        it('returns completedLate when finished after the due date in Eastern Time', () => {
            const row = item({ completion_status: 'completed', completed_at: new Date('2026-10-21T04:30:00Z') });
            expect(computeStatus(row, TODAY)).to.equal('completedLate');
        });

        it('returns completed when no completion time is recorded', () => {
            expect(computeStatus(item({ completion_status: 'completed' }), TODAY)).to.equal('completed');
        });

        it('returns notApplicable for a past-due item marked not applicable', () => {
            const row = item({ due_date: daysFromToday(-5), completion_status: 'notApplicable' });
            expect(computeStatus(row, TODAY)).to.equal('notApplicable');
        });
    });

    context('computeStatus for items needing review', () => {
        it('returns reviewNeeded for an undated item even when verified', () => {
            expect(computeStatus(item({ due_date: null }), TODAY)).to.equal('reviewNeeded');
        });

        it('adds the Unverified suffix for an unverified dated item', () => {
            const row = item({ due_date: daysFromToday(-1), verification_status: 'unverified' });
            expect(computeStatus(row, TODAY)).to.equal('overdueUnverified');
        });

        it('adds the Unverified suffix to closed statuses', () => {
            const row = item({ completion_status: 'notApplicable', verification_status: 'unverified' });
            expect(computeStatus(row, TODAY)).to.equal('notApplicableUnverified');
        });
    });

    context('isPortfolioItem', () => {
        it('accepts a verified dated item', () => {
            expect(isPortfolioItem(item())).to.equal(true);
        });

        it('rejects an unverified item', () => {
            expect(isPortfolioItem(item({ verification_status: 'unverified' }))).to.equal(false);
        });

        it('rejects an undated item', () => {
            expect(isPortfolioItem(item({ due_date: null }))).to.equal(false);
        });
    });

    context('ALLOWED_STATUSES', () => {
        it('lists every status computeStatus can return', () => {
            expect(ALLOWED_STATUSES).to.have.members([
                'overdue', 'dueToday', 'dueSoon', 'upcoming', 'completed', 'completedLate', 'notApplicable',
                'overdueUnverified', 'dueTodayUnverified', 'dueSoonUnverified', 'upcomingUnverified',
                'completedUnverified', 'completedLateUnverified', 'notApplicableUnverified', 'reviewNeeded',
            ]);
        });
    });
});
