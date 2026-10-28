import { afterEach, describe, expect, it } from 'vitest';
import {
  dateTimeRangeValue,
  moveAllDayRange,
  moveTimedRange,
  timeRangeFromValue,
  withAllDay,
} from './time-range';

const systemTimeZone = process.env.TZ;
afterEach(() => {
  process.env.TZ = systemTimeZone;
});

describe('the fields value of a time range', () => {
  it('shows an all-day range as its local days, the end day included', () => {
    process.env.TZ = 'Asia/Tokyo';
    expect(
      dateTimeRangeValue({
        allDay: true,
        start: new Date(2026, 9, 9),
        end: new Date(2026, 9, 13),
      })
    ).toEqual({ allDay: true, start: '2026-10-09', end: '2026-10-13' });
  });

  it('shows a timed range as local wall-clock times', () => {
    process.env.TZ = 'America/New_York';
    expect(
      dateTimeRangeValue({
        allDay: false,
        start: new Date('2026-10-09T13:00:00.000Z'),
        end: new Date('2026-10-10T03:30:00.000Z'),
      })
    ).toEqual({
      allDay: false,
      start: '2026-10-09T09:00',
      end: '2026-10-09T23:30',
    });
  });

  it('reads local wall-clock times as instants on either side of a DST change', () => {
    process.env.TZ = 'America/New_York';
    // Clocks spring forward at 2:00 on 2026-03-08.
    expect(
      timeRangeFromValue({
        allDay: false,
        start: '2026-03-08T01:00',
        end: '2026-03-08T04:00',
      })
    ).toEqual({
      allDay: false,
      start: new Date('2026-03-08T06:00:00.000Z'),
      end: new Date('2026-03-08T08:00:00.000Z'),
    });
    // And fall back at 2:00 on 2026-11-01.
    expect(
      dateTimeRangeValue({
        allDay: false,
        start: new Date('2026-11-01T04:30:00.000Z'),
        end: new Date('2026-11-01T07:30:00.000Z'),
      })
    ).toEqual({
      allDay: false,
      start: '2026-11-01T00:30',
      end: '2026-11-01T02:30',
    });
  });

  it('reads an all-day value as local midnights, the end day included', () => {
    process.env.TZ = 'America/New_York';
    expect(
      timeRangeFromValue({
        allDay: true,
        start: '2026-03-07',
        end: '2026-03-09',
      })
    ).toEqual({
      allDay: true,
      start: new Date(2026, 2, 7),
      end: new Date(2026, 2, 9),
    });
  });

  it('reads no range until both ends are set, keeping a backwards one for its caller', () => {
    process.env.TZ = 'UTC';
    expect(
      timeRangeFromValue({ allDay: true, start: '2026-10-09', end: '' })
    ).toBeUndefined();
    expect(
      timeRangeFromValue({ allDay: false, start: '2026-10-09', end: '' })
    ).toBeUndefined();
    expect(
      timeRangeFromValue({
        allDay: true,
        start: '2026-10-13',
        end: '2026-10-09',
      })
    ).toEqual({
      allDay: true,
      start: new Date(2026, 9, 13),
      end: new Date(2026, 9, 9),
    });
  });
});

describe('moving the start', () => {
  it('carries an all-day end along, keeping the number of days', () => {
    expect(
      moveAllDayRange(
        { allDay: true, start: '2026-10-09', end: '2026-10-13' },
        '2026-10-30'
      )
    ).toEqual({ allDay: true, start: '2026-10-30', end: '2026-11-03' });
    expect(
      moveAllDayRange({ allDay: true, start: '', end: '' }, '2026-10-30')
    ).toEqual({ allDay: true, start: '2026-10-30', end: '2026-10-30' });
  });

  it('carries a timed end along, keeping the duration across a DST change', () => {
    process.env.TZ = 'America/New_York';
    expect(
      moveTimedRange(
        { allDay: false, start: '2026-03-07T09:00', end: '2026-03-07T10:30' },
        '2026-03-08T01:30'
      )
    ).toEqual({
      allDay: false,
      start: '2026-03-08T01:30',
      end: '2026-03-08T04:00',
    });
  });
});

describe('All day', () => {
  it('keeps each end’s day when turned on', () => {
    expect(
      withAllDay(
        { allDay: false, start: '2026-10-09T09:00', end: '2026-10-13T17:00' },
        true
      )
    ).toEqual({ allDay: true, start: '2026-10-09', end: '2026-10-13' });
  });

  it('gives each end the next full hour, an hour long, when turned off', () => {
    process.env.TZ = 'America/New_York';
    const now = new Date(2026, 9, 26, 14, 20);
    expect(
      withAllDay(
        { allDay: true, start: '2026-10-09', end: '2026-10-13' },
        false,
        now
      )
    ).toEqual({
      allDay: false,
      start: '2026-10-09T15:00',
      end: '2026-10-13T16:00',
    });
    expect(
      withAllDay({ allDay: true, start: '', end: '' }, false, now)
    ).toEqual({
      allDay: false,
      start: '2026-10-26T15:00',
      end: '2026-10-26T16:00',
    });
  });

  it('starts at midnight of the start day when turned off late at night', () => {
    expect(
      withAllDay(
        { allDay: true, start: '2026-10-09', end: '2026-10-09' },
        false,
        new Date(2026, 9, 26, 23, 40)
      )
    ).toEqual({
      allDay: false,
      start: '2026-10-09T00:00',
      end: '2026-10-09T01:00',
    });
  });
});
