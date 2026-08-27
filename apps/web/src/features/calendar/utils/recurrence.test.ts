import { format } from 'date-fns';
import { describe, expect, it } from 'vitest';
import {
  buildRecurrenceLines,
  defaultCustomConfig,
  formatRecurrenceDescription,
  monthlyOrdinalFor,
  parseRecurrenceConfig,
  parseRecurrenceLines,
  type RecurrenceConfig,
  recurrenceConfigsEqual,
  recurrencePresetsFor,
} from './recurrence';

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

// Friday, August 7 2026 (local).
const friday = new Date(2026, 7, 7, 14, 0, 0);

// Timed rules end at local end-of-day rendered in UTC, so the expected
// UNTIL depends on the zone the tests run in.
const timedUntil = (date: string) =>
  `${new Date(`${date}T23:59:59`)
    .toISOString()
    .slice(0, 19)
    .replaceAll(/[-:]/g, '')}Z`;

describe('buildRecurrenceLines', () => {
  it('serializes the shapes the custom editor produces', () => {
    expect(
      buildRecurrenceLines(
        { frequency: 'DAILY', interval: 1, byDay: [], ends: { kind: 'never' } },
        false
      )
    ).toEqual(['RRULE:FREQ=DAILY']);
    expect(
      buildRecurrenceLines(
        {
          frequency: 'WEEKLY',
          interval: 2,
          byDay: ['FR', 'MO'],
          ends: { kind: 'after', count: 13 },
        },
        false
      )
    ).toEqual(['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,FR;COUNT=13']);
    expect(
      buildRecurrenceLines(
        {
          frequency: 'MONTHLY',
          interval: 1,
          byDay: [],
          monthlyByDay: { ordinal: 1, weekday: 'FR' },
          ends: { kind: 'on', date: '2026-11-06' },
        },
        false
      )
    ).toEqual([
      `RRULE:FREQ=MONTHLY;BYDAY=1FR;UNTIL=${timedUntil('2026-11-06')}`,
    ]);
  });

  it('serializes timed UNTIL in the recurrence timezone', () => {
    expect(
      buildRecurrenceLines(
        {
          frequency: 'DAILY',
          interval: 1,
          byDay: [],
          ends: { kind: 'on', date: '2026-08-22' },
        },
        false,
        'America/Los_Angeles'
      )
    ).toEqual(['RRULE:FREQ=DAILY;UNTIL=20260823T065959Z']);
  });

  it('uses a date-valued UNTIL for all-day events', () => {
    expect(
      buildRecurrenceLines(
        {
          frequency: 'DAILY',
          interval: 1,
          byDay: [],
          ends: { kind: 'on', date: '2026-11-06' },
        },
        true
      )
    ).toEqual(['RRULE:FREQ=DAILY;UNTIL=20261106']);
  });
});

describe('parseRecurrenceConfig', () => {
  it('round-trips everything the editor can build', () => {
    const configs: RecurrenceConfig[] = [
      { frequency: 'DAILY', interval: 3, byDay: [], ends: { kind: 'never' } },
      {
        frequency: 'WEEKLY',
        interval: 1,
        byDay: ['MO', 'WE', 'FR'],
        ends: { kind: 'after', count: 5 },
      },
      {
        frequency: 'MONTHLY',
        interval: 2,
        byDay: [],
        monthlyByDay: { ordinal: -1, weekday: 'SU' },
        ends: { kind: 'on', date: '2027-01-31' },
      },
      { frequency: 'YEARLY', interval: 1, byDay: [], ends: { kind: 'never' } },
    ];
    for (const config of configs) {
      const parsed = parseRecurrenceConfig(buildRecurrenceLines(config, false));
      expect(parsed).toBeDefined();
      expect(recurrenceConfigsEqual(parsed as RecurrenceConfig, config)).toBe(
        true
      );
    }
  });

  it('parses UNTIL values Google emits as the local end date', () => {
    const parsed = parseRecurrenceConfig([
      'RRULE:FREQ=WEEKLY;UNTIL=20261106T045959Z;BYDAY=FR',
    ]);
    // 2026-11-06T04:59:59Z is 23:59:59 the previous evening in US Eastern;
    // the config surfaces whatever calendar date that instant falls on here.
    const localDate = format(
      new Date(Date.UTC(2026, 10, 6, 4, 59, 59)),
      'yyyy-MM-dd'
    );
    expect(parsed?.ends).toEqual({ kind: 'on', date: localDate });
  });

  it('round-trips timed UNTIL in the recurrence timezone', () => {
    const lines = ['RRULE:FREQ=DAILY;UNTIL=20260823T065959Z'];
    const parsed = parseRecurrenceConfig(lines, 'America/Los_Angeles');
    expect(parsed?.ends).toEqual({ kind: 'on', date: '2026-08-22' });
    expect(
      parsed && buildRecurrenceLines(parsed, false, 'America/Los_Angeles')
    ).toEqual(lines);
  });

  it('declines rules it cannot round-trip', () => {
    expect(parseRecurrenceConfig([])).toBeUndefined();
    expect(
      parseRecurrenceConfig(['RRULE:FREQ=MONTHLY;BYMONTHDAY=15'])
    ).toBeUndefined();
    expect(
      parseRecurrenceConfig([
        'RRULE:FREQ=DAILY',
        'EXDATE;TZID=UTC:20260810T140000',
      ])
    ).toBeUndefined();
    expect(parseRecurrenceConfig(['RRULE:FREQ=HOURLY'])).toBeUndefined();
    expect(
      parseRecurrenceConfig(['RRULE:FREQ=WEEKLY;BYDAY=2FR'])
    ).toBeUndefined();
  });
});

describe('recurrencePresetsFor', () => {
  it('phrases presets from the start date like Google', () => {
    const labels = recurrencePresetsFor(friday).map((preset) => preset.label);
    expect(labels).toEqual([
      'Daily',
      'Weekly on Friday',
      'Monthly on the first Friday',
      'Annually on August 7',
      'Every weekday (Monday to Friday)',
    ]);
  });

  it('uses "last" for a fifth weekday of the month', () => {
    // Friday, July 31 2026 is the fifth Friday.
    expect(monthlyOrdinalFor(new Date(2026, 6, 31))).toEqual({
      ordinal: -1,
      weekday: 'FR',
    });
    const monthly = recurrencePresetsFor(new Date(2026, 6, 31)).find(
      (preset) => preset.id === 'monthly'
    );
    expect(monthly?.label).toBe('Monthly on the last Friday');
  });

  it('matches parsed configs back to presets', () => {
    for (const preset of recurrencePresetsFor(friday)) {
      const parsed = parseRecurrenceConfig(
        buildRecurrenceLines(preset.config, false)
      );
      expect(parsed).toBeDefined();
      expect(
        recurrenceConfigsEqual(parsed as RecurrenceConfig, preset.config)
      ).toBe(true);
    }
  });
});

describe('defaultCustomConfig', () => {
  it('starts weekly on the event weekday', () => {
    expect(defaultCustomConfig(friday)).toEqual({
      frequency: 'WEEKLY',
      interval: 1,
      byDay: ['FR'],
      ends: { kind: 'never' },
    });
  });
});
