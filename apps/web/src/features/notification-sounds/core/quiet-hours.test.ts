import { expect, it } from 'vitest';
import {
  type DayQuietHours,
  DEFAULT_QUIET_HOURS,
  isWithinQuietHours,
  parseQuietHours,
  type QuietHours,
  quietHoursMute,
  WEEKDAYS,
  type Weekday,
} from './quiet-hours';

function day(
  startHour: number,
  endHour: number,
  mode: DayQuietHours['mode'] = 'hours'
): DayQuietHours {
  return {
    mode,
    startMinutes: startHour * 60,
    endMinutes: endHour * 60,
  };
}

function schedule(
  startHour: number,
  endHour: number,
  active: readonly Weekday[] = WEEKDAYS,
  timeZone = 'UTC'
): QuietHours {
  const selected = new Set(active);
  const hoursFor = (weekday: Weekday) =>
    day(startHour, endHour, selected.has(weekday) ? 'hours' : 'off');
  return {
    enabled: true,
    timeZone,
    days: {
      mon: hoursFor('mon'),
      tue: hoursFor('tue'),
      wed: hoursFor('wed'),
      thu: hoursFor('thu'),
      fri: hoursFor('fri'),
      sat: hoursFor('sat'),
      sun: hoursFor('sun'),
    },
  };
}

it('stays off until quiet hours are turned on', () => {
  expect(
    isWithinQuietHours(DEFAULT_QUIET_HOURS, new Date('2026-11-04T04:00:00Z'))
  ).toBe(false);
  expect(parseQuietHours(undefined)).toEqual(DEFAULT_QUIET_HOURS);
});

it('includes the start of a same-day window and excludes the end', () => {
  const quiet = schedule(9, 17);
  expect(isWithinQuietHours(quiet, new Date('2026-11-04T08:59:00Z'))).toBe(
    false
  );
  expect(isWithinQuietHours(quiet, new Date('2026-11-04T09:00:00Z'))).toBe(
    true
  );
  expect(isWithinQuietHours(quiet, new Date('2026-11-04T16:59:00Z'))).toBe(
    true
  );
  expect(isWithinQuietHours(quiet, new Date('2026-11-04T17:00:00Z'))).toBe(
    false
  );
});

it('applies an overnight window to that calendar day only', () => {
  const tuesday = schedule(22, 8, ['tue']);
  expect(isWithinQuietHours(tuesday, new Date('2026-11-03T23:30:00Z'))).toBe(
    true
  );
  expect(isWithinQuietHours(tuesday, new Date('2026-11-03T07:00:00Z'))).toBe(
    true
  );
  expect(isWithinQuietHours(tuesday, new Date('2026-11-03T12:00:00Z'))).toBe(
    false
  );
  // Wednesday morning belongs to Wednesday, not to Tuesday's late window.
  expect(isWithinQuietHours(tuesday, new Date('2026-11-04T01:00:00Z'))).toBe(
    false
  );
});

it('lets each day use its own hours, stay off, or cover the whole day', () => {
  const quiet = schedule(22, 8);
  quiet.days.sat = day(0, 12);
  quiet.days.sun = day(0, 0, 'off');
  quiet.days.fri = day(0, 0, 'all-day');

  // Saturday's morning window, not the weekday overnight window.
  expect(isWithinQuietHours(quiet, new Date('2026-11-07T11:00:00Z'))).toBe(
    true
  );
  expect(isWithinQuietHours(quiet, new Date('2026-11-07T23:00:00Z'))).toBe(
    false
  );
  // Sunday is off, including the morning a Saturday overnight window would cover.
  expect(isWithinQuietHours(quiet, new Date('2026-11-08T01:00:00Z'))).toBe(
    false
  );
  expect(isWithinQuietHours(quiet, new Date('2026-11-08T18:00:00Z'))).toBe(
    false
  );
  // Friday is quiet at noon.
  expect(isWithinQuietHours(quiet, new Date('2026-11-06T12:00:00Z'))).toBe(
    true
  );
  // Monday still uses 10:00 PM to 8:00 AM.
  expect(isWithinQuietHours(quiet, new Date('2026-11-02T23:00:00Z'))).toBe(
    true
  );
  expect(isWithinQuietHours(quiet, new Date('2026-11-02T15:00:00Z'))).toBe(
    false
  );
});

it('reads the clock in the schedule time zone', () => {
  const instant = new Date('2026-11-04T04:30:00Z');
  expect(
    isWithinQuietHours(schedule(22, 8, undefined, 'America/New_York'), instant)
  ).toBe(true);
  expect(
    isWithinQuietHours(
      schedule(22, 8, undefined, 'America/Los_Angeles'),
      instant
    )
  ).toBe(false);
});

it('covers nothing when the start and end match or no day is selected', () => {
  const noon = new Date('2026-11-04T12:00:00Z');
  expect(isWithinQuietHours(schedule(9, 9), noon)).toBe(false);
  expect(isWithinQuietHours(schedule(0, 23, []), noon)).toBe(false);
});

it('lets calls through and silences other alerts', () => {
  const quiet = schedule(0, 12);
  const during = new Date('2026-11-04T01:00:00Z');
  expect(quietHoursMute('channel_mention', quiet, during)).toBe(true);
  expect(quietHoursMute('call_started', quiet, during)).toBe(false);
  expect(
    quietHoursMute('channel_mention', quiet, new Date('2026-11-04T18:00:00Z'))
  ).toBe(false);
});

it('keeps a saved per-day schedule and a shared window from the first release', () => {
  const shared = day(22, 8);
  const off = day(22, 8, 'off');
  expect(
    parseQuietHours({
      enabled: true,
      startMinutes: 22 * 60,
      endMinutes: 8 * 60,
      days: ['fri', 'nope', 'mon'],
      timeZone: 'America/New_York',
    })
  ).toEqual({
    enabled: true,
    timeZone: 'America/New_York',
    days: {
      mon: shared,
      tue: off,
      wed: off,
      thu: off,
      fri: shared,
      sat: off,
      sun: off,
    },
  });

  expect(
    parseQuietHours({
      enabled: true,
      timeZone: 'Not/AZone',
      startMinutes: 99.5,
      days: [],
    })
  ).toEqual({
    enabled: true,
    timeZone: '',
    days: {
      mon: day(22, 8, 'off'),
      tue: day(22, 8, 'off'),
      wed: day(22, 8, 'off'),
      thu: day(22, 8, 'off'),
      fri: day(22, 8, 'off'),
      sat: day(22, 8, 'off'),
      sun: day(22, 8, 'off'),
    },
  });

  expect(
    parseQuietHours({
      enabled: true,
      timeZone: 'UTC',
      days: {
        sat: { mode: 'hours', startMinutes: 0, endMinutes: 12 * 60 },
        sun: { mode: 'all-day', startMinutes: 1.5, endMinutes: 30 },
        mon: { mode: 'later', startMinutes: 15 },
      },
    })
  ).toEqual({
    enabled: true,
    timeZone: 'UTC',
    days: {
      mon: { mode: 'hours', startMinutes: 15, endMinutes: 8 * 60 },
      tue: day(22, 8),
      wed: day(22, 8),
      thu: day(22, 8),
      fri: day(22, 8),
      sat: day(0, 12),
      sun: { mode: 'all-day', startMinutes: 22 * 60, endMinutes: 30 },
    },
  });
});
