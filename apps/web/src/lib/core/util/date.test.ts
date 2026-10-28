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
