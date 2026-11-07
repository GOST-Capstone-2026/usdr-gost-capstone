import { describe, it, expect } from 'vitest';
import { statusLabel, statusVariant, isClosedStatus } from '@/helpers/deadlineStatus';

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
});
