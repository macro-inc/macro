import { describe, expect, it } from 'vitest';
import {
  completedTypedTime,
  DAY_TIME_OPTIONS,
  dayOffsetBetween,
  endTimeOptions,
  endValueFor,
  formatDuration,
  matchTypedTime,
  parseTimeValue,
  selectedTimeOptionId,
  splitLocalDateTime,
  typedTimeCandidates,
  typedTimeOption,
  withinEndTimeWindow,
} from './time-options';

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

describe('formatDuration', () => {
  it('formats sub-hour durations in minutes', () => {
    expect(formatDuration(15)).toBe('15min');
    expect(formatDuration(45)).toBe('45min');
  });

  it('drops the minutes on whole hours', () => {
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(180)).toBe('3h');
  });

  it('combines both units otherwise', () => {
    expect(formatDuration(75)).toBe('1h 15min');
    expect(formatDuration(1425)).toBe('23h 45min');
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

describe('typedTimeCandidates', () => {
  it('reads a bare hour as either half of the day', () => {
    expect(typedTimeCandidates('3')).toEqual([180, 900]);
    expect(typedTimeCandidates('12')).toEqual([0, 720]);
  });

  it('reads a meridiem however it is written', () => {
    expect(typedTimeCandidates('3p')).toEqual([900]);
    expect(typedTimeCandidates('3 PM')).toEqual([900]);
    expect(typedTimeCandidates('3:30a.m.')).toEqual([210]);
    expect(typedTimeCandidates('12am')).toEqual([0]);
    expect(typedTimeCandidates('12pm')).toEqual([720]);
  });

  it('reads minutes with or without a colon', () => {
    expect(typedTimeCandidates('330')).toEqual([210, 930]);
    expect(typedTimeCandidates('1530')).toEqual([930]);
    expect(typedTimeCandidates('15:30')).toEqual([930]);
    expect(typedTimeCandidates('0:05')).toEqual([5]);
  });

  it('reads noon and midnight', () => {
    expect(typedTimeCandidates('Noon')).toEqual([720]);
    expect(typedTimeCandidates('midnight')).toEqual([0]);
  });

  it('reads nothing from partial or impossible entries', () => {
    expect(typedTimeCandidates('')).toEqual([]);
    expect(typedTimeCandidates('3:')).toEqual([]);
    expect(typedTimeCandidates('3:3')).toEqual([]);
    expect(typedTimeCandidates('24')).toEqual([]);
    expect(typedTimeCandidates('13pm')).toEqual([]);
    expect(typedTimeCandidates('3:75')).toEqual([]);
    expect(typedTimeCandidates('soon')).toEqual([]);
  });
});

describe('matchTypedTime', () => {
  it('takes the morning first in a day list', () => {
    expect(matchTypedTime(DAY_TIME_OPTIONS, '3')?.value).toBe('03:00');
    expect(matchTypedTime(DAY_TIME_OPTIONS, '3p')?.value).toBe('15:00');
  });

  it('takes the reading soonest after the start in an end list', () => {
    const options = endTimeOptions('20:00');

    expect(matchTypedTime(options, '9')).toMatchObject({
      value: '21:00',
      dayOffset: 0,
      detail: '1h',
    });
    expect(matchTypedTime(options, '7')).toMatchObject({
      value: '07:00',
      dayOffset: 1,
    });
  });

  it('follows a partial entry to the first time it begins', () => {
    expect(matchTypedTime(DAY_TIME_OPTIONS, '3:')?.value).toBe('03:00');
    expect(matchTypedTime(DAY_TIME_OPTIONS, '3:3')?.value).toBe('03:30');
    expect(matchTypedTime(DAY_TIME_OPTIONS, '15:4')?.value).toBe('15:45');
  });

  it('matches nothing for a complete time no option lists', () => {
    expect(matchTypedTime(DAY_TIME_OPTIONS, '3:07')).toBeUndefined();
    expect(matchTypedTime(DAY_TIME_OPTIONS, 'soon')).toBeUndefined();
  });
});

describe('typedTimeOption', () => {
  it('commits to the matched option', () => {
    expect(typedTimeOption(endTimeOptions('20:00'), '9a')).toMatchObject({
      value: '09:00',
      dayOffset: 1,
      detail: '13h',
    });
  });

  it('keeps an unlisted time exactly, on the anchor day', () => {
    const option = typedTimeOption(endTimeOptions('20:00'), '20:07');

    expect(option).toMatchObject({ value: '20:07', dayOffset: 0 });
    expect(option?.detail).toBeUndefined();
  });

  it('reads an unlisted bare time as the one soonest after the list starts', () => {
    expect(typedTimeOption(DAY_TIME_OPTIONS, '3:07')?.value).toBe('03:07');
    expect(typedTimeOption(endTimeOptions('20:00'), '9:10')?.value).toBe(
      '21:10'
    );
  });

  it('commits nothing for an entry that is no time', () => {
    expect(typedTimeOption(DAY_TIME_OPTIONS, 'soon')).toBeUndefined();
    expect(typedTimeOption(DAY_TIME_OPTIONS, '')).toBeUndefined();
  });
});

describe('completedTypedTime', () => {
  const threeAm = DAY_TIME_OPTIONS.find((option) => option.value === '03:00');

  it('fills in the rest of the label the entry begins', () => {
    expect(completedTypedTime('3', threeAm)).toBe(threeAm?.label);
    expect(completedTypedTime('3:0', threeAm)).toBe(threeAm?.label);
  });

  it('leaves entries that do not begin the label', () => {
    expect(completedTypedTime('3p', threeAm)).toBeUndefined();
    expect(completedTypedTime('03', threeAm)).toBeUndefined();
    expect(completedTypedTime('', threeAm)).toBeUndefined();
    expect(completedTypedTime('3', undefined)).toBeUndefined();
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

    const nine = typedTimeOption(options, '9am');
    const sevenPast = typedTimeOption(options, '9:07am');

    expect(nine && endValueFor(START, nine)).toBe('2026-03-11T09:00');
    expect(sevenPast && endValueFor(START, sevenPast)).toBe('2026-03-11T09:07');
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
