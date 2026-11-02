import { describe, expect, it } from 'vitest';
import { formatTimeZoneAbbreviation } from './date';

describe('formatTimeZoneAbbreviation', () => {
  it('names the zone in effect at the instant, across daylight saving', () => {
    const summer = new Date('2026-07-01T16:00:00Z');
    const winter = new Date('2027-01-03T16:00:00Z');
    expect(formatTimeZoneAbbreviation(summer, 'America/New_York')).toBe('EDT');
    expect(formatTimeZoneAbbreviation(winter, 'America/New_York')).toBe('EST');
    expect(formatTimeZoneAbbreviation(winter, 'UTC')).toBe('UTC');
  });
});

it('preserves locale, time zone, and invalid date output when reusing formatters', async () => {
  const { formatTime, formatDate, formatEmailDate } = await import('./date');
  const dates = [
    new Date('2024-07-04T15:30:00Z'),
    new Date('2024-01-01T00:00:00Z'),
  ];
  for (const date of dates) {
    for (const timeZone of [
      undefined,
      'UTC',
      'America/New_York',
      'Asia/Tokyo',
    ]) {
      expect(formatTime(date, timeZone)).toBe(
        date.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
          timeZone,
        })
      );
      expect(formatDate(date, { timeZone })).toBe(
        date.toLocaleDateString(undefined, {
          month: '2-digit',
          day: '2-digit',
          year: '2-digit',
          timeZone,
        })
      );
    }
  }
  expect(formatTime('invalid')).toBe('Invalid Date');
  expect(formatEmailDate(new Date('2024-07-04T15:30:00Z'))).toBe(
    `Thu, Jul 4, 2024 at ${formatTime(new Date('2024-07-04T15:30:00Z'))}`
  );
});
