import { describe, expect, it } from 'vitest';
import {
  buildRecurrenceLines,
  defaultCustomConfig,
  monthlyOrdinalFor,
  parseRecurrenceConfig,
  type RecurrenceConfig,
  recurrenceConfigsEqual,
  recurrencePresetsFor,
} from './recurrence-editor';

// Friday, August 7 2026 (local).
const friday = new Date(2026, 7, 7, 14, 0, 0);

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
    ).toEqual(['RRULE:FREQ=MONTHLY;BYDAY=1FR;UNTIL=20261106T235959Z']);
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

  it('parses UNTIL values Google emits', () => {
    const parsed = parseRecurrenceConfig([
      'RRULE:FREQ=WEEKLY;UNTIL=20261106T045959Z;BYDAY=FR',
    ]);
    expect(parsed?.ends).toEqual({ kind: 'on', date: '2026-11-06' });
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
