import { expect, it } from 'vitest';
import { formatReminderOccurrence } from './schedule-instant';

it('uses a compact exact instant without repeating a local zone', () => {
  expect(
    formatReminderOccurrence(
      '2026-10-15T13:00:00Z',
      'America/New_York',
      'America/New_York'
    )
  ).toBe('Oct 15, 2026 at 9:00 AM');
});
it('gets a foreign zone from the occurrence across DST', () => {
  expect(
    formatReminderOccurrence('2026-10-15T13:00:00Z', 'America/New_York', 'UTC')
  ).toContain('9:00 AM EDT');
  expect(
    formatReminderOccurrence('2026-11-15T14:00:00Z', 'America/New_York', 'UTC')
  ).toContain('9:00 AM EST');
});
it('disambiguates both instances of a repeated local hour', () => {
  expect(
    formatReminderOccurrence(
      '2026-11-01T05:30:00Z',
      'America/New_York',
      'America/New_York'
    )
  ).toContain('1:30 AM EDT');
  expect(
    formatReminderOccurrence(
      '2026-11-01T06:30:00Z',
      'America/New_York',
      'America/New_York'
    )
  ).toContain('1:30 AM EST');
});
it('preserves nonzero seconds', () => {
  expect(
    formatReminderOccurrence('2026-10-15T09:00:30Z', 'UTC', 'UTC')
  ).toContain('9:00:30 AM');
});
it.each([
  ['invalid', 'UTC'],
  ['2026-10-15T09:00:00Z', 'Invalid/Zone'],
])('handles an unavailable instant/zone %s %s', (instant, zone) => {
  expect(formatReminderOccurrence(instant, zone)).toBeUndefined();
});
