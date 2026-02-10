import { describe, expect, it } from 'vitest';
import {
  formatTimestamp,
  formatRelativeTimestamp,
} from '../src/utils/timestamp';

describe('formatTimestamp', () => {
  describe('timestamp format handling', () => {
    it('handles Unix timestamp (seconds)', () => {
      // January 1, 2025 at 12:00 PM
      const unixSeconds = 1735732800;
      const result = formatTimestamp(unixSeconds);
      // Should format based on when test runs, but should not throw
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });

    it('handles millisecond timestamp', () => {
      // January 1, 2025 at 12:00 PM
      const milliseconds = 1735732800000;
      const result = formatTimestamp(milliseconds);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });

  describe('time formatting for today', () => {
    it("formats today's timestamp with time only", () => {
      const now = Date.now();
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
      const result = formatTimestamp(date.getTime());

      // Should be format like "Jan 15"
      expect(result).toMatch(/^[A-Z][a-z]{2}\s\d{1,2}$/);
    });
  });

  describe('date formatting for previous years', () => {
    it('formats old dates with full date', () => {
      // January 15, 2020
      const oldDate = new Date(2020, 0, 15);
      const result = formatTimestamp(oldDate.getTime());

      // Should be format like "1/15/20"
      expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);
    });
  });
});

describe('formatRelativeTimestamp', () => {
  describe('timestamp format handling', () => {
    it('handles Unix timestamp (seconds)', () => {
      const unixSeconds = Math.floor(Date.now() / 1000) - 300; // 5 minutes ago
      const result = formatRelativeTimestamp(unixSeconds);
      expect(result).toContain('minute');
    });

    it('handles millisecond timestamp', () => {
      const milliseconds = Date.now() - 300000; // 5 minutes ago
      const result = formatRelativeTimestamp(milliseconds);
      expect(result).toContain('minute');
    });
  });

  describe('just now', () => {
    it('returns "just now" for very recent timestamps', () => {
      const now = Date.now();
      expect(formatRelativeTimestamp(now)).toBe('just now');
      expect(formatRelativeTimestamp(now - 30000)).toBe('just now'); // 30 seconds ago
    });
  });

  describe('minutes ago', () => {
    it('formats timestamps within last hour as minutes', () => {
      const oneMinuteAgo = Date.now() - 60000;
      expect(formatRelativeTimestamp(oneMinuteAgo)).toBe('1 minute ago');
    });

    it('uses plural for multiple minutes', () => {
      const fiveMinutesAgo = Date.now() - 300000;
      expect(formatRelativeTimestamp(fiveMinutesAgo)).toBe('5 minutes ago');
    });

    it('handles 59 minutes correctly', () => {
      const fiftyNineMinutesAgo = Date.now() - 59 * 60000;
      expect(formatRelativeTimestamp(fiftyNineMinutesAgo)).toBe(
        '59 minutes ago'
      );
    });
  });

  describe('hours ago', () => {
    it('formats timestamps within 24 hours as hours', () => {
      const oneHourAgo = Date.now() - 3600000;
      expect(formatRelativeTimestamp(oneHourAgo)).toBe('1 hour ago');
    });

    it('uses plural for multiple hours', () => {
      const threeHoursAgo = Date.now() - 3 * 3600000;
      expect(formatRelativeTimestamp(threeHoursAgo)).toBe('3 hours ago');
    });

    it('handles 23 hours correctly', () => {
      const twentyThreeHoursAgo = Date.now() - 23 * 3600000;
      expect(formatRelativeTimestamp(twentyThreeHoursAgo)).toBe('23 hours ago');
    });
  });

  describe('yesterday', () => {
    it('formats yesterday with time', () => {
      // Create yesterday's date
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);
      yesterday.setHours(14, 30, 0, 0); // 2:30 PM

      const result = formatRelativeTimestamp(yesterday.getTime());
      expect(result).toContain('yesterday');
      expect(result).toMatch(/\d{1,2}:\d{2}(am|pm)/i);
    });
  });

  describe('same year older dates', () => {
    it('formats dates in same year as "MMM d"', () => {
      // Create a date 30 days ago in current year
      const date = new Date();
      date.setDate(date.getDate() - 30);

      const result = formatRelativeTimestamp(date.getTime());
      // Should be format like "Jan 15"
      expect(result).toMatch(/^[A-Z][a-z]{2}\s\d{1,2}$/);
    });
  });

  describe('previous years', () => {
    it('formats old dates with full date', () => {
      // January 15, 2020
      const oldDate = new Date(2020, 0, 15);
      const result = formatRelativeTimestamp(oldDate.getTime());

      // Should be format like "1/15/20"
      expect(result).toMatch(/^\d{1,2}\/\d{1,2}\/\d{2}$/);
    });
  });

  describe('edge cases', () => {
    it('handles future timestamps gracefully', () => {
      const future = Date.now() + 3600000; // 1 hour in future
      const result = formatRelativeTimestamp(future);
      // Should return "just now" since difference is < 1 minute
      expect(result).toBe('just now');
    });

    it('handles very old timestamps', () => {
      const veryOld = new Date(1990, 0, 1).getTime();
      const result = formatRelativeTimestamp(veryOld);
      expect(typeof result).toBe('string');
      expect(result.length).toBeGreaterThan(0);
    });
  });
});
