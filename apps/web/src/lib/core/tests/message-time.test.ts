import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { formatMessageTime } from '../util/date';
import { formatConversationDay, formatRelativeDate } from '../util/time';

// Wednesday.
const NOW = new Date(2026, 10, 25, 14, 33);

// Intl may put a narrow no-break space before the day period.
const plainSpaces = (text: string) => text.replace(/\s/g, ' ');

/** The browser's locale: what Intl falls back to when none is passed. */
function stubBrowserLocale(locale: string) {
  const formatDateTime = Date.prototype.toLocaleString;
  const formatTime = Date.prototype.toLocaleTimeString;
  vi.spyOn(Date.prototype, 'toLocaleString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions
  ) {
    return formatDateTime.call(this, locales ?? locale, options);
  });
  vi.spyOn(Date.prototype, 'toLocaleTimeString').mockImplementation(function (
    this: Date,
    locales?: Intl.LocalesArgument,
    options?: Intl.DateTimeFormatOptions
  ) {
    return formatTime.call(this, locales ?? locale, options);
  });
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('formatMessageTime', () => {
  describe('in US English', () => {
    beforeEach(() => {
      stubBrowserLocale('en-US');
    });

    it.each([
      ['now', new Date(2026, 10, 25, 14, 33), '2:33 PM'],
      ['the first minute of today', new Date(2026, 10, 25, 0, 0), '12:00 AM'],
      [
        'the last minute of yesterday',
        new Date(2026, 10, 24, 23, 59),
        'Yesterday at 11:59 PM',
      ],
      [
        'the first minute of yesterday',
        new Date(2026, 10, 24, 0, 0),
        'Yesterday at 12:00 AM',
      ],
      [
        'two days ago, under 48 hours',
        new Date(2026, 10, 23, 23, 59),
        '11/23/26, 11:59 PM',
      ],
      [
        'the same weekday last week',
        new Date(2026, 10, 18, 14, 33),
        '11/18/26, 2:33 PM',
      ],
      ['another year', new Date(2025, 11, 31, 9, 5), '12/31/25, 9:05 AM'],
      [
        'just after midnight, before our clock gets there',
        new Date(2026, 10, 26, 0, 0),
        '12:00 AM',
      ],
    ])('shows %s', (_, sentAt, expected) => {
      expect(plainSpaces(formatMessageTime(sentAt, NOW))).toBe(expected);
    });

    it('calls New Year’s Eve yesterday on New Year’s Day', () => {
      const newYearsDay = new Date(2027, 0, 1, 8, 0);
      const newYearsEve = new Date(2026, 11, 31, 23, 47);

      expect(plainSpaces(formatMessageTime(newYearsEve, newYearsDay))).toBe(
        'Yesterday at 11:47 PM'
      );
    });
  });

  it.each([
    ['en-GB', '14:05', 'Yesterday at 23:47', '06/11/2026, 14:33'],
    ['de-DE', '14:05', 'Yesterday at 23:47', '06.11.26, 14:33'],
  ])(
    'follows the date order and 24-hour clock of %s',
    (locale, today, yesterday, older) => {
      stubBrowserLocale(locale);

      expect(formatMessageTime(new Date(2026, 10, 25, 14, 5), NOW)).toBe(today);
      expect(formatMessageTime(new Date(2026, 10, 24, 23, 47), NOW)).toBe(
        yesterday
      );
      expect(formatMessageTime(new Date(2026, 10, 6, 14, 33), NOW)).toBe(older);
    }
  );
});

describe('formatConversationDay', () => {
  it.each([
    ['today', new Date(2026, 10, 25, 0, 0), 'Today'],
    ['yesterday', new Date(2026, 10, 24, 23, 59), 'Yesterday'],
    ['six days ago', new Date(2026, 10, 19, 0, 0), 'Thursday'],
    [
      'the same weekday last week, under 7 x 24 hours ago',
      new Date(2026, 10, 18, 23, 59),
      'Nov 18',
    ],
    ['another year', new Date(2025, 10, 18, 9, 0), 'Nov 18, 2025'],
  ])('names %s', (_, date, expected) => {
    expect(formatConversationDay(date, NOW)).toBe(expected);
  });

  it('leaves labels that do not follow the current day on the weekday', () => {
    expect(formatRelativeDate(new Date(2026, 10, 24, 23, 59), NOW)).toBe(
      'Tuesday'
    );
  });
});
