import { expect, it } from 'vitest';
import {
  DEFAULT_QUIET_HOURS,
  isWithinQuietHours,
  parseQuietHours,
  type QuietHours,
  quietHoursMute,
} from './quiet-hours';

function schedule(
  startHour: number,
  endHour: number,
  days: QuietHours['days'] = DEFAULT_QUIET_HOURS.days,
  timeZone = 'UTC'
): QuietHours {
  return {
    enabled: true,
    startMinutes: startHour * 60,
    endMinutes: endHour * 60,
    days,
    timeZone,
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

it('applies an overnight window to each selected calendar day', () => {
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

it('keeps a saved schedule and drops fields that cannot be a schedule', () => {
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
    startMinutes: 22 * 60,
    endMinutes: 8 * 60,
    days: ['mon', 'fri'],
    timeZone: 'America/New_York',
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
    startMinutes: DEFAULT_QUIET_HOURS.startMinutes,
    endMinutes: DEFAULT_QUIET_HOURS.endMinutes,
    days: [],
    timeZone: '',
  });
});
