import { describe, expect, it } from 'vitest';
import { formatDate } from '../util/date';

const epochTime = (str: string) => Math.floor(new Date(str).getTime() / 1000);

// Use June 14, 2025 at 10:15 AM as a reference time.
const mockNow = '2025-06-14T14:15:00.000Z';
const mockNowEpochSeconds = epochTime(mockNow);

describe('Date Utilities (core/utils/date.ts)', () => {
  describe('formatDate', () => {
    it('should should show only time at Date.now()', () => {
      const now = epochTime(new Date().toISOString());
      const result = formatDate(now);
      expect(result).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    });

    it('should show correct date with no params', () => {
      const result = formatDate(mockNowEpochSeconds);
      expect(result).toMatch('06/14/25');
    });

    it('should format time for today', () => {
      // Today at 8:15 AM
      const todayMorning = epochTime('2025-06-14T08:15:00.000Z');
      expect(formatDate(todayMorning, mockNowEpochSeconds)).toBe('8:15 AM');
    });

    it('should format "Yesterday at {time}" for yesterday (UTC day boundary)', () => {
      // Yesterday at 11:00 PM UTC (June 13)
      const yesterdayEvening = epochTime('2025-06-13T23:00:00.000Z');
      expect(formatDate(yesterdayEvening, mockNowEpochSeconds)).toBe(
        'Yesterday at 11:00 PM'
      );
    });

    it('should handle edge case at UTC midnight boundary', () => {
      // Reference time: June 14, 2:15 PM UTC
      // Yesterday at 11:59 PM UTC (June 13) - just before midnight
      const justBeforeMidnight = epochTime('2025-06-13T23:59:59.000Z');
      expect(formatDate(justBeforeMidnight, mockNowEpochSeconds)).toBe(
        'Yesterday at 11:59 PM'
      );
    });

    it('should handle same day even with less than 24 hour difference', () => {
      // Reference time: June 14, 2:15 PM UTC
      // Same day at 1:00 AM UTC (13.25 hours earlier, but same UTC day)
      const earlyToday = epochTime('2025-06-14T01:00:00.000Z');
      expect(formatDate(earlyToday, mockNowEpochSeconds)).toBe('1:00 AM');
    });

    it('should handle yesterday even with more than 24 hour difference', () => {
      // Reference time: June 14, 2:15 PM UTC
      // Yesterday at 1:00 AM UTC (37.25 hours earlier, but still "yesterday")
      const yesterdayEarly = epochTime('2025-06-13T01:00:00.000Z');
      expect(formatDate(yesterdayEarly, mockNowEpochSeconds)).toBe(
        'Yesterday at 1:00 AM'
      );
    });

    it('should format weekday for recent days (2-6 days ago)', () => {
      // June 12 (2 days ago) - should show weekday
      const twoDaysAgo = epochTime('2025-06-12T15:00:00.000Z');
      expect(formatDate(twoDaysAgo, mockNowEpochSeconds)).toBe('Thursday');
    });

    it('should format date for older dates (more than 7 days)', () => {
      // June 1, 2025 (13 days ago)
      const oldDate = epochTime('2025-06-01T12:00:00.000Z');
      expect(formatDate(oldDate, mockNowEpochSeconds)).toBe('06/01/25');
    });

    it('should handle timezone-aware day boundaries', () => {
      // Reference: June 14, 2025 at 2:15 PM UTC
      // Test timestamp: June 14 at 11:30 PM Eastern (3:30 AM UTC June 15)

      // In Eastern timezone, this should be "Today"
      const lateEastern = epochTime('2025-06-15T03:30:00.000Z');
      expect(
        formatDate(lateEastern, mockNowEpochSeconds, 'America/New_York')
      ).toBe('11:30 PM');

      // In UTC timezone, this should be "Tomorrow" (but we'll get weekday since it's >1 day diff)
      // Let's test with a timestamp that's same day in Eastern but different day in UTC
      const easternToday = epochTime('2025-06-14T23:30:00.000Z');
      expect(
        formatDate(easternToday, mockNowEpochSeconds, 'America/New_York')
      ).toBe('7:30 PM');
    });

    it('should handle edge case where formatToParts fails gracefully', () => {
      // This test ensures our fallback values prevent month=-1 or day=0 edge cases
      // We can't easily mock formatToParts to fail, but we can test with extreme dates
      const extremeDate = epochTime('1900-01-01T00:00:00.000Z');
      const result = formatDate(
        extremeDate,
        mockNowEpochSeconds,
        'America/New_York'
      );

      // Should not throw and should return a reasonable date format (not crash due to invalid Date)
      expect(typeof result).toBe('string');
      // The exact date format may vary by timezone, but it should be a valid date string
      expect(result).toMatch(/^\d{2}\/\d{2}\/\d{2}$/);
    });
  });
});
