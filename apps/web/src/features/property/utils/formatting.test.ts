import { describe, expect, it, vi } from 'vitest';
import { formatDate, formatDateValue, formatTimeRange } from './formatting';

vi.mock('@app/features/calendar/utils/preferences', () => ({
  useCalendarPreferences: () => [{ timeFormat: '12-hour' }],
}));

describe('formatDate', () => {
  it('shows a day as its short month, day and year', () => {
    expect(formatDate(new Date(2025, 2, 14))).toBe('Mar 14, 2025');
    expect(formatDate(new Date(2026, 11, 1, 23, 59))).toBe('Dec 1, 2026');
  });
});

describe('formatTimeRange', () => {
  it('shows an all-day range as its days, sharing the month and year', () => {
    expect(
      formatTimeRange({
        allDay: true,
        start: new Date(2026, 9, 9),
        end: new Date(2026, 9, 13),
      })
    ).toBe('Oct 9\u2009–\u200913, 2026');
    expect(
      formatTimeRange({
        allDay: true,
        start: new Date(2026, 9, 9),
        end: new Date(2026, 9, 9),
      })
    ).toBe('Oct 9, 2026');
  });

  // ICU versions differ on the space before AM/PM; the range content is the contract.
  it('shows a timed range on one day as the day and both times', () => {
    expect(
      formatTimeRange({
        allDay: false,
        start: new Date(2026, 9, 9, 9),
        end: new Date(2026, 9, 9, 17),
      }).replaceAll('\u202f', ' ')
    ).toBe('Oct 9, 9:00 AM\u2009–\u20095:00 PM');
  });

  it('shows a timed range over days as each day with its time', () => {
    expect(
      formatTimeRange({
        allDay: false,
        start: new Date(2026, 9, 9, 9),
        end: new Date(2026, 9, 13, 17),
      }).replaceAll('\u202f', ' ')
    ).toBe('Oct 9, 9:00 AM\u2009–\u2009Oct 13, 5:00 PM');
  });
});

describe('formatDateValue', () => {
  const now = new Date(2026, 10, 20);

  it('adds a compact time of day to a date that has one while times are shown', () => {
    expect(
      formatDateValue(new Date(2026, 10, 26, 14, 30), true, true, now)
    ).toBe('Nov 26, 2:30pm');
    expect(formatDateValue(new Date(2026, 10, 26, 14), true, true, now)).toBe(
      'Nov 26, 2pm'
    );
    expect(formatDateValue(new Date(2027, 0, 4, 9), true, true, now)).toBe(
      'Jan 4, 2027, 9am'
    );
  });

  it('shows the day alone for a whole day, or while times are not shown', () => {
    const at = new Date(2026, 10, 26, 14, 30);
    expect(formatDateValue(at, undefined, true, now)).toBe(formatDate(at));
    expect(formatDateValue(at, true, false, now)).toBe(formatDate(at));
  });
});
