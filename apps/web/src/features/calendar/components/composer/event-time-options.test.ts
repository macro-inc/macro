import { describe, expect, it } from 'vitest';
import {
  DAY_TIME_OPTIONS,
  dayOffsetBetween,
  endTimeOptions,
  endValueFor,
  formatEventDuration,
  parseTimeValue,
  resolveTimeOption,
  selectedTimeOptionId,
  splitLocalDateTime,
  withinEndTimeWindow,
} from './event-time-options';

describe('DAY_TIME_OPTIONS', () => {
  it('covers every quarter-hour of one day', () => {
    expect(DAY_TIME_OPTIONS).toHaveLength(96);
    expect(DAY_TIME_OPTIONS[0]?.value).toBe('00:00');
    expect(DAY_TIME_OPTIONS.at(-1)?.value).toBe('23:45');
    expect(DAY_TIME_OPTIONS.every((option) => option.dayOffset === 0)).toBe(
      true
    );
    expect(
      DAY_TIME_OPTIONS.every((option) => option.detail === undefined)
    ).toBe(true);
  });
});

describe('formatEventDuration', () => {
  it('formats sub-hour durations in minutes', () => {
    expect(formatEventDuration(15)).toBe('15min');
    expect(formatEventDuration(45)).toBe('45min');
  });

  it('drops the minutes on whole hours', () => {
    expect(formatEventDuration(60)).toBe('1h');
    expect(formatEventDuration(180)).toBe('3h');
  });

  it('combines both units otherwise', () => {
    expect(formatEventDuration(75)).toBe('1h 15min');
    expect(formatEventDuration(1425)).toBe('23h 45min');
  });
});

describe('endTimeOptions', () => {
  it('spans 15 minutes to 23h45min after the start', () => {
    const options = endTimeOptions('09:00');

    expect(options).toHaveLength(95);
    expect(options[0]).toMatchObject({
      value: '09:15',
      dayOffset: 0,
      detail: '15min',
    });
    expect(options[3]).toMatchObject({ value: '10:00', detail: '1h' });
    expect(options.at(-1)).toMatchObject({
      value: '08:45',
      dayOffset: 1,
      detail: '23h 45min',
    });
  });

  it('rolls past midnight onto the following day', () => {
    const options = endTimeOptions('20:00');
    const midnight = options.find((option) => option.value === '00:00');

    expect(midnight).toMatchObject({ dayOffset: 1, detail: '4h' });
    expect(options.filter((option) => option.dayOffset === 0)).toHaveLength(15);
  });

  it('never offers the start time itself, and never repeats one', () => {
    const options = endTimeOptions('13:30');

    expect(options.some((option) => option.value === '13:30')).toBe(false);
    expect(new Set(options.map((option) => option.id)).size).toBe(
      options.length
    );
    expect(new Set(options.map((option) => option.value)).size).toBe(
      options.length
    );
  });

  it('falls back to the plain day when the start is unusable', () => {
    expect(endTimeOptions('')).toBe(DAY_TIME_OPTIONS);
    expect(endTimeOptions('99:99')).toBe(DAY_TIME_OPTIONS);
  });
});

describe('parseTimeValue', () => {
  it('reads minutes past midnight, ignoring seconds', () => {
    expect(parseTimeValue('00:00')).toBe(0);
    expect(parseTimeValue('09:45')).toBe(585);
    expect(parseTimeValue('23:45:00')).toBe(1425);
  });

  it('rejects values outside a clock', () => {
    expect(parseTimeValue('')).toBeUndefined();
    expect(parseTimeValue('24:00')).toBeUndefined();
    expect(parseTimeValue('12:60')).toBeUndefined();
  });
});

describe('resolveTimeOption', () => {
  it('matches a typed time to the option it lands on', () => {
    const options = endTimeOptions('20:00');

    expect(resolveTimeOption(options, '09:00')).toMatchObject({
      dayOffset: 1,
      detail: '13h',
    });
  });

  it('keeps an unlisted time on the anchor day', () => {
    const options = endTimeOptions('20:00');

    expect(resolveTimeOption(options, '20:07')).toMatchObject({
      value: '20:07',
      dayOffset: 0,
    });
    expect(resolveTimeOption(options, '20:07').detail).toBeUndefined();
  });
});

describe('endValueFor', () => {
  it('keeps the start date for same-day options', () => {
    expect(
      endValueFor('2026-03-10T09:00', { value: '10:30', dayOffset: 0 })
    ).toBe('2026-03-10T10:30');
  });

  it('advances the date for options past midnight', () => {
    expect(
      endValueFor('2026-03-31T20:00', { value: '02:00', dayOffset: 1 })
    ).toBe('2026-04-01T02:00');
  });

  it('pulls a multi-day end back onto the anchored day', () => {
    expect(
      endValueFor('2026-03-10T09:00', { value: '17:00', dayOffset: 0 })
    ).toBe('2026-03-10T17:00');
  });

  it('rolls a hand-typed time that would precede the start', () => {
    expect(
      endValueFor('2026-03-10T20:00', { value: '09:07', dayOffset: 0 })
    ).toBe('2026-03-11T09:07');
  });

  it('rolls a hand-typed time that equals the start', () => {
    expect(
      endValueFor('2026-03-10T20:00', { value: '20:00', dayOffset: 0 })
    ).toBe('2026-03-11T20:00');
  });
});

describe('an end that has fallen behind its start', () => {
  const START = '2026-03-10T20:00';
  const END = '2026-03-10T09:00';

  it('still offers the durations measured from the start', () => {
    expect(withinEndTimeWindow(START, END)).toBe(true);

    const options = endTimeOptions(splitLocalDateTime(START).time);
    expect(options[0]).toMatchObject({ value: '20:15', detail: '15min' });
    expect(options.find((option) => option.value === '09:00')).toMatchObject({
      dayOffset: 1,
      detail: '13h',
    });
  });

  it('highlights nothing, since no offered option describes it', () => {
    const options = endTimeOptions(splitLocalDateTime(START).time);
    const selected = selectedTimeOptionId(
      splitLocalDateTime(END).time,
      dayOffsetBetween(START, END)
    );

    expect(options.some((option) => option.id === selected)).toBe(false);
  });

  it('lands the next morning once a time is chosen or typed', () => {
    const options = endTimeOptions(splitLocalDateTime(START).time);

    expect(endValueFor(START, resolveTimeOption(options, '09:00'))).toBe(
      '2026-03-11T09:00'
    );
    expect(endValueFor(START, resolveTimeOption(options, '09:07'))).toBe(
      '2026-03-11T09:07'
    );
  });
});

describe('dayOffsetBetween', () => {
  it('counts whole calendar days', () => {
    expect(dayOffsetBetween('2026-03-10T09:00', '2026-03-10T23:45')).toBe(0);
    expect(dayOffsetBetween('2026-03-10T09:00', '2026-03-11T00:15')).toBe(1);
    expect(dayOffsetBetween('2026-03-10T09:00', '2026-03-09T23:45')).toBe(-1);
  });

  it('reads zero when either side is unusable', () => {
    expect(dayOffsetBetween('', '2026-03-11T00:15')).toBe(0);
  });
});

describe('selectedTimeOptionId', () => {
  it('addresses the option a value currently holds', () => {
    const options = endTimeOptions('20:00');
    const id = selectedTimeOptionId('00:00', 1);

    expect(options.find((option) => option.id === id)?.detail).toBe('4h');
  });

  it('matches nothing when the end sits outside the offered window', () => {
    const options = endTimeOptions('20:00');
    const id = selectedTimeOptionId('00:00', 3);

    expect(options.some((option) => option.id === id)).toBe(false);
  });
});

describe('withinEndTimeWindow', () => {
  it('accepts spans up to 23h45min', () => {
    expect(withinEndTimeWindow('2026-03-10T09:00', '2026-03-10T10:00')).toBe(
      true
    );
    expect(withinEndTimeWindow('2026-03-10T20:00', '2026-03-11T02:00')).toBe(
      true
    );
    expect(withinEndTimeWindow('2026-03-10T09:00', '2026-03-11T08:45')).toBe(
      true
    );
  });

  it('accepts an end that has fallen behind the start', () => {
    expect(withinEndTimeWindow('2026-03-10T20:00', '2026-03-10T09:00')).toBe(
      true
    );
  });

  it('rejects longer spans, which keep their own end date', () => {
    expect(withinEndTimeWindow('2026-03-10T09:00', '2026-03-11T09:00')).toBe(
      false
    );
    expect(withinEndTimeWindow('2026-03-10T09:00', '2026-03-13T17:00')).toBe(
      false
    );
  });

  it('rejects unusable values', () => {
    expect(withinEndTimeWindow('2026-03-10', '2026-03-11')).toBe(false);
  });
});
