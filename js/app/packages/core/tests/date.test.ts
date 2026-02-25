import { max } from 'date-fns';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  compareDateAsc,
  compareDateDesc,
  convertIsoString,
  formatDate,
} from '../util/date';

// Use June 14, 2025 at 10:15 AM New York time (EDT/UTC-4) as a reference time.
const mockNow: Date = new Date('2025-06-14T14:15:00.000Z');
const NEW_YORK_TZ = 'America/New_York';

describe('Date Utilities (core/utils/date.ts)', () => {
  beforeEach(() => {
    // default system time to UTC
    process.env.TZ = 'UTC';

    vi.setSystemTime(mockNow);
  });

  describe('formatDate', () => {
    it('should should show only time at Date.now()', () => {
      const now = new Date();
      const result = formatDate(now);
      expect(result).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    });

    it('should show correct time for now with default UTC system time', () => {
      const result = formatDate(mockNow);
      expect(result).toMatch('2:15 PM');
    });

    it('should accept ISO string input', () => {
      const result = formatDate('2025-06-14T14:15:00.000Z');
      expect(result).toMatch('2:15 PM');
    });

    it('should show correct time for now with no params and new york system time', () => {
      process.env.TZ = NEW_YORK_TZ;
      const result = formatDate(mockNow);
      expect(result).toMatch('10:15 AM');
    });

    it('should show correct time for new york timezone param', () => {
      const result = formatDate(mockNow, { timeZone: NEW_YORK_TZ });
      expect(result).toMatch('10:15 AM');
    });

    it('should format time for today', () => {
      // Today at 8:15 AM UTC
      const todayMorning: Date = new Date('2025-06-14T08:15:00.000Z');
      expect(formatDate(todayMorning)).toBe('8:15 AM');
    });

    it('should format "Yesterday at {time}" for yesterday (UTC day boundary)', () => {
      // Yesterday at 11:00 PM UTC (June 13)
      const yesterdayEvening: Date = new Date('2025-06-13T23:00:00.000Z');
      expect(formatDate(yesterdayEvening)).toBe('Yesterday at 11:00 PM');
    });

    it('should handle edge case at UTC midnight boundary', () => {
      // Reference time: June 14, 2:15 PM UTC
      // Yesterday at 11:59 PM UTC (June 13) - just before midnight
      const justBeforeMidnight: Date = new Date('2025-06-13T23:59:59.000Z');
      expect(formatDate(justBeforeMidnight)).toBe('Yesterday at 11:59 PM');
    });

    it('should handle same day even with less than 24 hour difference', () => {
      // Reference time: June 14, 2:15 PM UTC
      // Same day at 1:00 AM UTC (13.25 hours earlier, but same UTC day)
      const earlyToday: Date = new Date('2025-06-14T01:00:00.000Z');
      expect(formatDate(earlyToday)).toBe('1:00 AM');
    });

    it('should handle yesterday even with more than 24 hour difference', () => {
      // Reference time: June 14, 2:15 PM UTC
      // Yesterday at 1:00 AM UTC (37.25 hours earlier, but still "yesterday")
      const yesterdayEarly: Date = new Date('2025-06-13T01:00:00.000Z');
      expect(formatDate(yesterdayEarly)).toBe('Yesterday at 1:00 AM');
    });

    it('should format weekday for recent days (2-6 days ago)', () => {
      // June 12 (2 days ago) - should show weekday
      const twoDaysAgo: Date = new Date('2025-06-12T15:00:00.000Z');
      expect(formatDate(twoDaysAgo)).toBe('Thursday');
    });

    it('should format date for older dates (more than 7 days)', () => {
      // June 1, 2025 (13 days ago)
      const oldDate: Date = new Date('2025-06-01T12:00:00.000Z');
      expect(formatDate(oldDate)).toBe('06/01/25');
    });

    it('should handle timezone-aware day boundaries', () => {
      // Reference: June 14, 2025 at 2:15 PM UTC
      // Test timestamp: June 14 at 11:30 PM Eastern (3:30 AM UTC June 15)

      // In Eastern timezone, this should be "Today"
      const lateEastern: Date = new Date('2025-06-15T03:30:00.000Z');
      expect(
        formatDate(lateEastern, {
          timeZone: NEW_YORK_TZ,
        })
      ).toBe('11:30 PM');

      // In UTC timezone, this should be "Tomorrow" (but we'll get weekday since it's >1 day diff)
      // Let's test with a timestamp that's same day in Eastern but different day in UTC
      const easternToday: Date = new Date('2025-06-14T23:30:00.000Z');
      expect(
        formatDate(easternToday, {
          timeZone: NEW_YORK_TZ,
        })
      ).toBe('7:30 PM');
    });

    it('should handle edge case where formatToParts fails gracefully', () => {
      // This test ensures our fallback values prevent month=-1 or day=0 edge cases
      // We can't easily mock formatToParts to fail, but we can test with extreme dates
      const extremeDate: Date = new Date('1900-01-01T00:00:00.000Z');
      const result = formatDate(extremeDate, {
        timeZone: NEW_YORK_TZ,
      });

      // Should not throw and should return a reasonable date format (not crash due to invalid Date)
      expect(typeof result).toBe('string');
      // The exact date format may vary by timezone, but it should be a valid date string
      expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
    });

    describe('showTime parameter', () => {
      it('should include time for weekday format when showTime is true', () => {
        // June 12 (2 days ago) - should show "Thursday at {time}"
        const twoDaysAgo: Date = new Date('2025-06-12T15:30:00.000Z');
        expect(
          formatDate(twoDaysAgo, {
            showTime: true,
          })
        ).toBe('Thursday at 3:30 PM');
      });

      it('should not include time for weekday format when showTime is false', () => {
        // June 12 (2 days ago) - should show only "Thursday"
        const twoDaysAgo: Date = new Date('2025-06-12T15:30:00.000Z');
        expect(
          formatDate(twoDaysAgo, {
            showTime: false,
          })
        ).toBe('Thursday');
      });

      it('should not include time for weekday format when showTime is undefined', () => {
        // June 12 (2 days ago) - should show only "Thursday" (default behavior)
        const twoDaysAgo: Date = new Date('2025-06-12T15:30:00.000Z');
        expect(
          formatDate(twoDaysAgo, {
            showTime: undefined,
          })
        ).toBe('Thursday');
      });

      it('should include time for date format when showTime is true', () => {
        // June 1, 2025 (13 days ago) - should show date with time
        const oldDate: Date = new Date('2025-06-01T16:45:00.000Z');
        expect(
          formatDate(oldDate, {
            showTime: true,
          })
        ).toBe('06/01/25 at 4:45 PM');
      });

      it('should not include time for date format when showTime is false', () => {
        // June 1, 2025 (13 days ago) - should show only date
        const oldDate: Date = new Date('2025-06-01T16:45:00.000Z');
        expect(
          formatDate(oldDate, {
            showTime: false,
          })
        ).toBe('06/01/25');
      });

      it('should not include time for date format when showTime is undefined', () => {
        // June 1, 2025 (13 days ago) - should show only date (default behavior)
        const oldDate: Date = new Date('2025-06-01T16:45:00.000Z');
        expect(
          formatDate(oldDate, {
            showTime: undefined,
          })
        ).toBe('06/01/25');
      });

      it('should not affect "today" format regardless of showTime (already shows time)', () => {
        // Today at 8:15 AM UTC
        const todayMorning: Date = new Date('2025-06-14T08:15:00.000Z');
        expect(
          formatDate(todayMorning, {
            showTime: true,
          })
        ).toBe('8:15 AM');
        expect(
          formatDate(todayMorning, {
            showTime: false,
          })
        ).toBe('8:15 AM');
      });

      it('should not affect "yesterday" format regardless of showTime (already shows time)', () => {
        // Yesterday at 11:00 PM UTC (June 13)
        const yesterdayEvening: Date = new Date('2025-06-13T23:00:00.000Z');
        expect(
          formatDate(yesterdayEvening, {
            showTime: true,
          })
        ).toBe('Yesterday at 11:00 PM');
        expect(
          formatDate(yesterdayEvening, {
            showTime: false,
          })
        ).toBe('Yesterday at 11:00 PM');
      });

      it('should handle showTime with timezone-aware formatting', () => {
        // June 12, 2025 at 11:30 PM Eastern (3:30 AM UTC June 13)
        const testDate: Date = new Date('2025-06-13T03:30:00.000Z');
        expect(
          formatDate(testDate, {
            timeZone: NEW_YORK_TZ,
            showTime: true,
          })
        ).toBe('Thursday at 11:30 PM');
      });

      it('should handle showTime for dates at the 7-day boundary', () => {
        // Exactly 7 days ago - should use date format
        const sevenDaysAgo: Date = new Date('2025-06-07T14:15:00.000Z');
        expect(
          formatDate(sevenDaysAgo, {
            showTime: true,
          })
        ).toBe('06/07/25 at 2:15 PM');
        expect(
          formatDate(sevenDaysAgo, {
            showTime: false,
          })
        ).toBe('06/07/25');
      });
    });
  });

  describe('compareDateDesc', () => {
    it('should sort more recent dates first (descending)', () => {
      const older = new Date('2025-01-01T00:00:00.000Z');
      const newer = new Date('2025-12-31T23:59:59.000Z');

      expect(compareDateDesc(newer, older)).toBeLessThan(0);
      expect(compareDateDesc(older, newer)).toBeGreaterThan(0);
    });

    it('should return 0 for equal dates', () => {
      const date1 = new Date('2025-06-15T12:00:00.000Z');
      const date2 = new Date('2025-06-15T12:00:00.000Z');

      expect(compareDateDesc(date1, date2)).toBe(0);
    });

    it('should treat null as epoch zero and sort after real dates', () => {
      const realDate = new Date('2025-06-15T12:00:00.000Z');

      expect(compareDateDesc(realDate, null)).toBeLessThan(0);
      expect(compareDateDesc(null, realDate)).toBeGreaterThan(0);
    });

    it('should treat undefined as epoch zero and sort after real dates', () => {
      const realDate = new Date('2025-06-15T12:00:00.000Z');

      expect(compareDateDesc(realDate, undefined)).toBeLessThan(0);
      expect(compareDateDesc(undefined, realDate)).toBeGreaterThan(0);
    });

    it('should return 0 when both dates are null', () => {
      expect(compareDateDesc(null, null)).toBe(0);
    });

    it('should return 0 when both dates are undefined', () => {
      expect(compareDateDesc(undefined, undefined)).toBe(0);
    });

    it('should return 0 when one is null and other is undefined', () => {
      expect(compareDateDesc(null, undefined)).toBe(0);
      expect(compareDateDesc(undefined, null)).toBe(0);
    });

    it('should work correctly in array sort (descending)', () => {
      const dates = [
        new Date('2025-03-15T00:00:00.000Z'),
        new Date('2025-01-01T00:00:00.000Z'),
        new Date('2025-12-31T00:00:00.000Z'),
      ];

      const sorted = [...dates].sort(compareDateDesc);

      expect(sorted[0]).toEqual(new Date('2025-12-31T00:00:00.000Z'));
      expect(sorted[1]).toEqual(new Date('2025-03-15T00:00:00.000Z'));
      expect(sorted[2]).toEqual(new Date('2025-01-01T00:00:00.000Z'));
    });

    it('should work with ISO string inputs', () => {
      const older = '2025-01-01T00:00:00.000Z';
      const newer = '2025-12-31T23:59:59.000Z';

      expect(compareDateDesc(newer, older)).toBeLessThan(0);
      expect(compareDateDesc(older, newer)).toBeGreaterThan(0);
    });

    it('should work with mixed string and Date inputs', () => {
      const olderString = '2025-01-01T00:00:00.000Z';
      const newerDate = new Date('2025-12-31T23:59:59.000Z');

      expect(compareDateDesc(newerDate, olderString)).toBeLessThan(0);
      expect(compareDateDesc(olderString, newerDate)).toBeGreaterThan(0);
    });
  });

  describe('compareDateAsc', () => {
    it('should sort older dates first (ascending)', () => {
      const older = new Date('2025-01-01T00:00:00.000Z');
      const newer = new Date('2025-12-31T23:59:59.000Z');

      expect(compareDateAsc(older, newer)).toBeLessThan(0);
      expect(compareDateAsc(newer, older)).toBeGreaterThan(0);
    });

    it('should return 0 for equal dates', () => {
      const date1 = new Date('2025-06-15T12:00:00.000Z');
      const date2 = new Date('2025-06-15T12:00:00.000Z');

      expect(compareDateAsc(date1, date2)).toBe(0);
    });

    it('should treat null as epoch zero and sort before real dates', () => {
      const realDate = new Date('2025-06-15T12:00:00.000Z');

      expect(compareDateAsc(null, realDate)).toBeLessThan(0);
      expect(compareDateAsc(realDate, null)).toBeGreaterThan(0);
    });

    it('should treat undefined as epoch zero and sort before real dates', () => {
      const realDate = new Date('2025-06-15T12:00:00.000Z');

      expect(compareDateAsc(undefined, realDate)).toBeLessThan(0);
      expect(compareDateAsc(realDate, undefined)).toBeGreaterThan(0);
    });

    it('should return 0 when both dates are null', () => {
      expect(compareDateAsc(null, null)).toBe(0);
    });

    it('should return 0 when both dates are undefined', () => {
      expect(compareDateAsc(undefined, undefined)).toBe(0);
    });

    it('should return 0 when one is null and other is undefined', () => {
      expect(compareDateAsc(null, undefined)).toBe(0);
      expect(compareDateAsc(undefined, null)).toBe(0);
    });

    it('should work with ISO string inputs', () => {
      const older = '2025-01-01T00:00:00.000Z';
      const newer = '2025-12-31T23:59:59.000Z';

      expect(compareDateAsc(older, newer)).toBeLessThan(0);
      expect(compareDateAsc(newer, older)).toBeGreaterThan(0);
    });
  });

  describe('date-fns max with RFC 3339 strings', () => {
    it('should correctly pick the latest of RFC 3339 strings', () => {
      const earlier = '2025-06-10T08:00:00Z';
      const later = '2025-06-14T12:00:00Z';

      const result = max([earlier, later]);
      expect(result).toEqual(new Date(later));
    });

    it('should correctly pick the latest when strings differ only by time', () => {
      const earlier = '2025-06-14T08:00:00Z';
      const later = '2025-06-14T20:30:00Z';

      const result = max([earlier, later]);
      expect(result).toEqual(new Date(later));
    });

    it('should handle a single string', () => {
      const only = '2025-06-14T12:00:00Z';

      const result = max([only]);
      expect(result).toEqual(new Date(only));
    });

    it('should handle multiple strings', () => {
      const a = '2025-01-01T00:00:00Z';
      const b = '2025-12-31T23:59:59Z';
      const c = '2025-06-15T12:00:00Z';

      const result = max([a, b, c]);
      expect(result).toEqual(new Date(b));
    });
  });

  describe('convertIsoString', () => {
    it('should convert valid ISO date string with Z suffix', () => {
      const result = convertIsoString('2025-02-11T10:30:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe('2025-02-11T10:30:00.000Z');
    });

    it('should convert valid ISO date string with milliseconds', () => {
      const result = convertIsoString('2025-02-11T10:30:00.123Z');
      expect(result).toBeInstanceOf(Date);
      expect(result!.toISOString()).toBe('2025-02-11T10:30:00.123Z');
    });

    it('should convert valid ISO date string without Z suffix', () => {
      const result = convertIsoString('2025-02-11T10:30:00');
      expect(result).toBeInstanceOf(Date);
    });

    it('should return undefined for non-ISO string', () => {
      expect(convertIsoString('hello world')).toBeUndefined();
    });

    it('should return undefined for date-only string', () => {
      expect(convertIsoString('2025-02-11')).toBeUndefined();
    });

    it('should return undefined for empty string', () => {
      expect(convertIsoString('')).toBeUndefined();
    });

    it('should return Date with NaN time for impossible date values', () => {
      const result = convertIsoString('2025-13-32T10:30:00Z');
      expect(result).toBeInstanceOf(Date);
      expect(result!.getTime()).toBe(NaN);
    });
  });
});
