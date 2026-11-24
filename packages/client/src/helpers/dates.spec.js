import {
  describe, beforeEach, afterEach, expect, it, vi,
} from 'vitest';
import { Settings } from 'luxon';
import { daysUntil, formatDate } from '@/helpers/dates';

describe('dates', () => {
  describe('formatDate() for a stored due date', () => {
    const originalZone = Settings.defaultZone;
    afterEach(() => {
      Settings.defaultZone = originalZone;
    });

    ['UTC', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Pacific/Auckland'].forEach((zone) => {
      it(`shows the stored day without shifting it when the browser is in ${zone}`, () => {
        Settings.defaultZone = zone;
        expect(formatDate('2026-03-08')).toBe('Mar 8, 2026');
        expect(formatDate('2026-11-01')).toBe('Nov 1, 2026');
        expect(formatDate('2028-02-29')).toBe('Feb 29, 2028');
        expect(formatDate('2026-12-31')).toBe('Dec 31, 2026');
      });
    });
  });

  describe('daysUntil()', () => {
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date('2021-01-15T22:00:00'));
    });
    afterEach(() => {
      vi.restoreAllMocks();
    });

    describe('when called with date in the past', () => {
      it('returns zero', () => {
        const result = daysUntil('2021-01-10');
        expect(result).toBe(0);
      });
    });
    describe('when called with today as date', () => {
      it('returns zero', () => {
        const result = daysUntil('2021-01-15');
        expect(result).toBe(0);
      });
    });
    describe('when called with tomorrow as date', () => {
      it('returns one', () => {
        const result = daysUntil('2021-01-16');
        expect(result).toBe(1);
      });
    });
    describe('when called with date in the future', () => {
      it('returns the correct number of days', () => {
        const result = daysUntil('2022-01-16');
        expect(result).toBe(366);
      });
    });
  });
});
