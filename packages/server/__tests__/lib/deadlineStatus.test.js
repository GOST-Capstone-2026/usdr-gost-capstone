const { expect } = require('chai');
const { DateTime, Settings } = require('luxon');
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

    context('calendar boundaries', () => {
        const todayAt = (iso) => getToday(DateTime.fromISO(iso));

        it('keeps a seven-day due-soon window across the spring daylight saving change', () => {
            const today = todayAt('2026-03-05T17:00:00Z');
            expect(computeStatus(item({ due_date: '2026-03-12' }), today)).to.equal('dueSoon');
            expect(computeStatus(item({ due_date: '2026-03-13' }), today)).to.equal('upcoming');
        });

        it('changes days at Eastern midnight on the spring daylight saving day', () => {
            expect(todayAt('2026-03-08T04:59:00Z').toISODate()).to.equal('2026-03-07');
            expect(todayAt('2026-03-08T05:00:00Z').toISODate()).to.equal('2026-03-08');
            expect(todayAt('2026-03-09T03:59:00Z').toISODate()).to.equal('2026-03-08');
            expect(todayAt('2026-03-09T04:00:00Z').toISODate()).to.equal('2026-03-09');
        });

        it('changes days at Eastern midnight on the fall daylight saving day', () => {
            expect(todayAt('2026-11-01T03:59:00Z').toISODate()).to.equal('2026-10-31');
            expect(todayAt('2026-11-01T04:00:00Z').toISODate()).to.equal('2026-11-01');
            expect(todayAt('2026-11-02T04:59:00Z').toISODate()).to.equal('2026-11-01');
            expect(todayAt('2026-11-02T05:00:00Z').toISODate()).to.equal('2026-11-02');
        });

        it('treats a deadline on the fall daylight saving day as due that whole day', () => {
            const row = item({ due_date: '2026-11-01' });
            expect(computeStatus(row, todayAt('2026-11-02T04:30:00Z'))).to.equal('dueToday');
            expect(computeStatus(row, todayAt('2026-11-02T05:30:00Z'))).to.equal('overdue');
        });

        it('crosses the year boundary', () => {
            expect(todayAt('2027-01-01T04:59:00Z').toISODate()).to.equal('2026-12-31');
            expect(computeStatus(item({ due_date: '2027-01-01' }), todayAt('2026-12-31T17:00:00Z'))).to.equal('dueSoon');
            expect(computeStatus(item({ due_date: '2026-12-31' }), todayAt('2027-01-01T17:00:00Z'))).to.equal('overdue');
        });

        it('counts February 29 as a day in a leap year', () => {
            const today = todayAt('2028-02-28T17:00:00Z');
            expect(computeStatus(item({ due_date: '2028-02-29' }), today)).to.equal('dueSoon');
            expect(computeStatus(item({ due_date: '2028-03-06' }), today)).to.equal('dueSoon');
            expect(computeStatus(item({ due_date: '2028-03-07' }), today)).to.equal('upcoming');
            expect(todayAt('2028-03-01T04:59:00Z').toISODate()).to.equal('2028-02-29');
        });

        it('marks a completion at 12:01 AM Eastern on the next day as late', () => {
            const row = item({ completion_status: 'completed', completed_at: new Date('2026-10-21T04:01:00Z') });
            expect(computeStatus(row, TODAY)).to.equal('completedLate');
        });

        it('lets completed and not applicable override an overdue date', () => {
            const overdueDate = daysFromToday(-3);
            const onTime = item({ due_date: overdueDate, completion_status: 'completed', completed_at: new Date(`${overdueDate}T15:00:00Z`) });
            expect(computeStatus(onTime, TODAY)).to.equal('completed');
            expect(computeStatus(item({ due_date: overdueDate, completion_status: 'notApplicable' }), TODAY)).to.equal('notApplicable');
        });
    });

    context('when the server runs in another time zone', () => {
        const originalZone = Settings.defaultZone;

        afterEach(() => {
            Settings.defaultZone = originalZone;
        });

        ['UTC', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland'].forEach((zone) => {
            it(`computes the same Eastern Time statuses when the default zone is ${zone}`, () => {
                Settings.defaultZone = zone;
                const lateEveningEastern = getToday(DateTime.fromISO('2026-10-21T03:30:00Z'));
                expect(lateEveningEastern.toISODate()).to.equal('2026-10-20');
                expect(computeStatus(item({ due_date: '2026-10-20' }), lateEveningEastern)).to.equal('dueToday');
                expect(computeStatus(item({ due_date: '2026-10-19' }), lateEveningEastern)).to.equal('overdue');
                const completedNextEasternDay = item({ completion_status: 'completed', completed_at: new Date('2026-10-21T04:30:00Z') });
                expect(computeStatus(completedNextEasternDay, lateEveningEastern)).to.equal('completedLate');
            });
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
