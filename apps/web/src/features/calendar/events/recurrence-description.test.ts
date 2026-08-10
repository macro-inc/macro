import { describe, expect, it } from 'vitest';
import {
  formatRecurrenceDescription,
  parseRecurrenceLines,
} from './recurrence-description';

describe('parseRecurrenceLines', () => {
  it('parses useful rule fields and explicit recurrence dates', () => {
    expect(
      parseRecurrenceLines([
        'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=WE,MO;COUNT=6;UNTIL=20261231T235959Z',
        'RDATE:20260801T090000Z,20260808T090000Z',
        'RDATE:20260808T090000Z',
        'EXDATE:20260815T090000Z',
      ])
    ).toEqual({
      hasRecurrenceRule: true,
      rule: {
        frequency: 'WEEKLY',
        interval: 2,
        byDay: [
          { weekday: 'WE', ordinal: undefined },
          { weekday: 'MO', ordinal: undefined },
        ],
        byMonthDay: [],
        byMonth: [],
        count: 6,
        until: '20261231T235959Z',
      },
      additionalDates: ['20260801T090000Z', '20260808T090000Z'],
      excludedDates: ['20260815T090000Z'],
    });
  });

  it('ignores invalid selectors and defaults invalid intervals to one', () => {
    expect(
      parseRecurrenceLines([
        'rrule:FREQ=monthly;INTERVAL=0;BYDAY=0MO,XX,2TU;BYMONTHDAY=0,32,-1;BYMONTH=0,12,13',
      ]).rule
    ).toEqual({
      frequency: 'MONTHLY',
      interval: 1,
      byDay: [{ weekday: 'TU', ordinal: 2 }],
      byMonthDay: [-1],
      byMonth: [12],
      count: undefined,
      until: undefined,
    });
  });
});

describe('formatRecurrenceDescription', () => {
  it.each([
    {
      name: 'daily',
      lines: ['RRULE:FREQ=DAILY'],
      expected: 'Daily',
    },
    {
      name: 'multi-day interval',
      lines: ['RRULE:FREQ=DAILY;INTERVAL=3'],
      expected: 'Every 3 days',
    },
    {
      name: 'weekly',
      lines: ['RRULE:FREQ=WEEKLY'],
      expected: 'Weekly',
    },
    {
      name: 'weekly on selected days',
      lines: ['RRULE:FREQ=WEEKLY;BYDAY=FR,MO,WE'],
      expected: 'Weekly on Monday, Wednesday, and Friday',
    },
    {
      name: 'biweekly on selected days',
      lines: ['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH'],
      expected: 'Every 2 weeks on Tuesday and Thursday',
    },
    {
      name: 'workweek',
      lines: ['RRULE:FREQ=WEEKLY;BYDAY=FR,WE,MO,TH,TU'],
      expected: 'Every weekday',
    },
    {
      name: 'monthly on numbered days',
      lines: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=1,15'],
      expected: 'Monthly on the 1st and 15th',
    },
    {
      name: 'monthly on the last day',
      lines: ['RRULE:FREQ=MONTHLY;BYMONTHDAY=-1'],
      expected: 'Monthly on the last day',
    },
    {
      name: 'monthly on an ordinal weekday',
      lines: ['RRULE:FREQ=MONTHLY;BYDAY=1MO'],
      expected: 'Monthly on the first Monday',
    },
    {
      name: 'monthly on every matching weekday',
      lines: ['RRULE:FREQ=MONTHLY;BYDAY=MO'],
      expected: 'Monthly on Monday',
    },
    {
      name: 'yearly on a date',
      lines: ['RRULE:FREQ=YEARLY;BYMONTH=1;BYMONTHDAY=1'],
      expected: 'Yearly on January 1',
    },
    {
      name: 'yearly in selected months',
      lines: ['RRULE:FREQ=YEARLY;BYMONTH=1,7'],
      expected: 'Yearly in January and July',
    },
    {
      name: 'yearly on an ordinal weekday in a month',
      lines: ['RRULE:FREQ=YEARLY;BYMONTH=11;BYDAY=-1TH'],
      expected: 'Yearly on the last Thursday in November',
    },
    {
      name: 'hourly interval',
      lines: ['RRULE:FREQ=HOURLY;INTERVAL=6'],
      expected: 'Every 6 hours',
    },
    {
      name: 'occurrence count',
      lines: ['RRULE:FREQ=DAILY;COUNT=3'],
      expected: 'Daily · 3 occurrences',
    },
    {
      name: 'single occurrence count',
      lines: ['RRULE:FREQ=DAILY;COUNT=1'],
      expected: 'Daily · 1 occurrence',
    },
    {
      name: 'end date',
      lines: ['RRULE:FREQ=WEEKLY;UNTIL=20260831T235959Z'],
      expected: 'Weekly · until August 31, 2026',
    },
    {
      name: 'additional and excluded dates',
      lines: [
        'RRULE:FREQ=WEEKLY',
        'RDATE:20260801,20260808',
        'EXDATE:20260815,20260815',
      ],
      expected: 'Weekly · 2 additional dates · 1 exception',
    },
    {
      name: 'RDATE-only recurrence',
      lines: ['RDATE:20260801,20260808'],
      expected: 'Repeats on 2 additional dates',
    },
    {
      name: 'malformed rule',
      lines: ['RRULE:INTERVAL=2'],
      expected: 'Recurring event',
    },
    {
      name: 'unsupported frequency',
      lines: ['RRULE:FREQ=FORTNIGHTLY'],
      expected: 'Recurring event',
    },
    {
      name: 'invalid interval and month day values',
      lines: ['RRULE:FREQ=MONTHLY;INTERVAL=-2;BYMONTHDAY=0,35'],
      expected: 'Monthly',
    },
  ])('formats $name', ({ lines, expected }) => {
    expect(formatRecurrenceDescription(lines, { locale: 'en-US' })).toBe(
      expected
    );
  });

  it('returns undefined when the lines do not declare recurrence', () => {
    expect(formatRecurrenceDescription([])).toBeUndefined();
    expect(formatRecurrenceDescription(['EXDATE:20260815'])).toBeUndefined();
    expect(formatRecurrenceDescription(['UNKNOWN:value'])).toBeUndefined();
  });
});
