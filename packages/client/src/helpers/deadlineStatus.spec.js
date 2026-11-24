import {
  describe, it, expect, afterEach,
} from 'vitest';
import { Settings } from 'luxon';
import {
  statusLabel, statusVariant, isClosedStatus, formatEasternDate, formatEasternDateTime,
} from '@/helpers/deadlineStatus';

describe('deadlineStatus helpers', () => {
  it('returns the display label and variant for a known status', () => {
    expect(statusLabel('completedLate')).toBe('Complete (Was Overdue)');
    expect(statusVariant('overdueUnverified')).toBe('danger');
  });

  it('falls back to the raw status and a neutral variant for an unknown status', () => {
    expect(statusLabel('somethingNew')).toBe('somethingNew');
    expect(statusVariant('somethingNew')).toBe('secondary');
  });

  it.each(['completed', 'completedLate', 'notApplicable', 'completedUnverified', 'completedLateUnverified', 'notApplicableUnverified'])(
    'treats %s as closed',
    (status) => {
      expect(isClosedStatus(status)).toBe(true);
    },
  );

  it.each(['overdue', 'dueToday', 'dueSoon', 'upcoming', 'dueSoonUnverified', 'reviewNeeded'])(
    'treats %s as open',
    (status) => {
      expect(isClosedStatus(status)).toBe(false);
    },
  );

  describe('Eastern Time timestamps', () => {
    const originalZone = Settings.defaultZone;
    afterEach(() => {
      Settings.defaultZone = originalZone;
    });

    ['UTC', 'America/Los_Angeles', 'Pacific/Auckland'].forEach((zone) => {
      it(`shows a late-evening Eastern verification on its Eastern day when the browser is in ${zone}`, () => {
        Settings.defaultZone = zone;
        expect(formatEasternDate('2026-10-21T02:30:00.000Z')).toBe('Oct 20, 2026');
        expect(formatEasternDateTime('2026-10-21T02:30:00.000Z')).toBe('Oct 20, 2026, 10:30 PM ET');
      });
    });

    it('follows daylight saving time', () => {
      expect(formatEasternDateTime('2026-03-09T15:00:00.000Z')).toBe('Mar 9, 2026, 11:00 AM ET');
      expect(formatEasternDateTime('2026-11-02T15:00:00.000Z')).toBe('Nov 2, 2026, 10:00 AM ET');
    });
  });
});
