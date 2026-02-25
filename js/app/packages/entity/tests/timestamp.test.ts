import { describe, expect, it } from 'vitest';
import {
  formatTimestamp,
  formatRelativeTimestamp,
} from '../src/utils/timestamp';
import { applyDurationToDate } from '@core/util/dateSearch/dateParser';

describe('formatTimestamp', () => {
  describe('Date object handling', () => {
    it('handles Date object', () => {
      // January 1, 2025 at 12:00 PM
      const date = new Date('2025-01-01T12:00:00.000Z');
      const result = formatTimestamp(date);
      // Should format based on when test runs, but should not throw
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('time formatting for today', () => {
    it("formats today's timestamp with time only", () => {
      const now = new Date();
      const result = formatTimestamp(now);
      // Should be in format like "2:30 PM"
      expect(result).toMatch(/\d{1,2}:\d{2}\s?(AM|PM)/i);
    });
  });

  describe('date formatting for same year', () => {
    it('formats same year date as "MMM d"', () => {
      // Create a date in the current year but not today
      const currentYear = new Date().getFullYear();
      const date = new Date(currentYear, 0, 15); // January 15
      const result = formatTimestamp(date);

      // Should be format like "Jan 15"
      expect(result).toMatch(/^[A-Z][a-z]{2}\s\d{1,2}$/);
    });
  });

  describe('date formatting for previous years', () => {
    it('formats old dates with full date', () => {
      // January 15, 2020
      const oldDate = new Date(2020, 0, 15);
      const result = formatTimestamp(oldDate);

      // Should be format like "1/15/20"
      expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);
    });
  });
});

describe('formatRelativeTimestamp', () => {
  describe('Date object handling', () => {
    it('handles Date object for recent time', () => {
      const fiveMinutesAgo = applyDurationToDate(new Date(), {
        value: -5,
        unit: 'min',
      });
      const result = formatRelativeTimestamp(fiveMinutesAgo);
      expect(result).toContain('minute');
    });
  });

  describe('just now', () => {
    it('returns "just now" for very recent timestamps', () => {
      const now = new Date();
      expect(formatRelativeTimestamp(now)).toBe('just now');

      const thirtySecondsAgo = applyDurationToDate(new Date(), {
        value: -30,
        unit: 's',
      });
      expect(formatRelativeTimestamp(thirtySecondsAgo)).toBe('just now');
    });
  });

  describe('minutes ago', () => {
    it('formats timestamps within last hour as minutes', () => {
      const oneMinuteAgo = applyDurationToDate(new Date(), {
        value: -1,
        unit: 'min',
      });
      expect(formatRelativeTimestamp(oneMinuteAgo)).toBe('1 minute ago');
    });

    it('uses plural for multiple minutes', () => {
      const fiveMinutesAgo = applyDurationToDate(new Date(), {
        value: -5,
        unit: 'min',
      });
      expect(formatRelativeTimestamp(fiveMinutesAgo)).toBe('5 minutes ago');
    });

    it('handles 59 minutes correctly', () => {
      const fiftyNineMinutesAgo = applyDurationToDate(new Date(), {
        value: -59,
        unit: 'min',
      });
      expect(formatRelativeTimestamp(fiftyNineMinutesAgo)).toBe(
        '59 minutes ago'
      );
    });
  });

  describe('hours ago', () => {
    it('formats timestamps within 24 hours as hours', () => {
      const oneHourAgo = applyDurationToDate(new Date(), {
        value: -1,
        unit: 'h',
      });
      expect(formatRelativeTimestamp(oneHourAgo)).toBe('1 hour ago');
    });

    it('uses plural for multiple hours', () => {
      const threeHoursAgo = applyDurationToDate(new Date(), {
        value: -3,
        unit: 'h',
      });
      expect(formatRelativeTimestamp(threeHoursAgo)).toBe('3 hours ago');
    });

    it('handles 23 hours correctly', () => {
      const twentyThreeHoursAgo = applyDurationToDate(new Date(), {
        value: -23,
        unit: 'h',
      });
      expect(formatRelativeTimestamp(twentyThreeHoursAgo)).toBe('23 hours ago');
    });
  });

  describe('yesterday', () => {
    it('formats yesterday with time', () => {
      // Create yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(14, 30, 0, 0); // 2:30 PM

      const result = formatRelativeTimestamp(yesterday);
      expect(result).toContain('yesterday');
      expect(result).toMatch(/\d{1,2}:\d{2}(am|pm)/i);
    });
  });

  describe('same year older dates', () => {
    it('formats dates in same year as "MMM d"', () => {
      // Create a date 30 days ago in current year
      const date = applyDurationToDate(new Date(), { value: -30, unit: 'd' });

      const result = formatRelativeTimestamp(date);
      // Should be format like "Jan 15"
      expect(result).toMatch(/^[A-Z][a-z]{2}\s\d{1,2}$/);
    });
  });

  describe('previous years', () => {
    it('formats old dates with full date', () => {
      // January 15, 2020
      const oldDate = new Date(2020, 0, 15);
      const result = formatRelativeTimestamp(oldDate);

      // Should be format like "1/15/20"
      expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);
    });
  });

  describe('edge cases', () => {
    it('handles future timestamps gracefully', () => {
      const future = applyDurationToDate(new Date(), { value: 1, unit: 'h' }); // 1 hour in future
      const result = formatRelativeTimestamp(future);
      // Should return "just now" since difference is < 1 minute
      expect(result).toBe('just now');
    });

    it('handles very old timestamps', () => {
      const veryOld = new Date(1990, 0, 1);
      const result = formatRelativeTimestamp(veryOld);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
