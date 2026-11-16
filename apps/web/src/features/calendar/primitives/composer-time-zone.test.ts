import type { EventTime } from '@service-calendar/generated/schemas/eventTime';
import { describe, expect, it } from 'vitest';
import { withComposerTimeZone } from './composer-time-zone';

const TIMED: EventTime = {
  kind: 'timed',
  startsAt: '2026-07-01T09:00:00Z',
  endsAt: '2026-07-01T10:00:00Z',
  timeZone: 'UTC',
};

describe('composer time-zone selection', () => {
  it('preserves imported point events when their displayed zone is nonlocal', () => {
    const point: EventTime = { ...TIMED, endsAt: TIMED.startsAt };
    expect(
      withComposerTimeZone(
        point,
        { allDay: false, start: '2026-07-01T09:00', end: '2026-07-01T09:00' },
        'America/New_York'
      )
    ).toMatchObject({
      startsAt: '2026-07-01T13:00:00.000Z',
      endsAt: '2026-07-01T13:00:00.000Z',
    });
  });

  it('rejects nonexistent DST times and reversed ranges without normalizing them', () => {
    expect(
      withComposerTimeZone(
        TIMED,
        {
          allDay: false,
          start: '2026-03-08T02:30',
          end: '2026-03-08T03:30',
        },
        'America/New_York'
      )
    ).toBeUndefined();
    expect(
      withComposerTimeZone(
        TIMED,
        {
          allDay: false,
          start: '2026-07-01T10:00',
          end: '2026-07-01T09:00',
        },
        'UTC'
      )
    ).toBeUndefined();
    expect(
      withComposerTimeZone(
        TIMED,
        {
          allDay: false,
          start: '2026-02-30T09:00',
          end: '2026-03-02T10:00',
        },
        'UTC'
      )
    ).toBeUndefined();
  });

  it('keeps the wall clock while converting a selected zone to instants', () => {
    expect(
      withComposerTimeZone(
        TIMED,
        {
          allDay: false,
          start: '2026-07-01T09:00',
          end: '2026-07-01T10:00',
        },
        'America/New_York'
      )
    ).toEqual({
      kind: 'timed',
      startsAt: '2026-07-01T13:00:00.000Z',
      endsAt: '2026-07-01T14:00:00.000Z',
      timeZone: 'America/New_York',
    });
  });

  it('uses calendar midnights for all-day out-of-office spans across DST', () => {
    expect(
      withComposerTimeZone(
        TIMED,
        {
          allDay: true,
          start: '2026-03-08',
          end: '2026-03-08',
        },
        'America/New_York'
      )
    ).toEqual({
      kind: 'timed',
      startsAt: '2026-03-08T05:00:00.000Z',
      endsAt: '2026-03-09T04:00:00.000Z',
      timeZone: 'America/New_York',
    });
  });

  it('does not attach a time zone to date-only events', () => {
    const time: EventTime = {
      kind: 'allDay',
      startDate: '2026-07-01',
      endDate: '2026-07-02',
    };
    expect(
      withComposerTimeZone(
        time,
        { allDay: true, start: '2026-07-01', end: '2026-07-01' },
        'America/New_York'
      )
    ).toBe(time);
  });

  it('rejects invalid zones and malformed local values', () => {
    expect(
      withComposerTimeZone(
        TIMED,
        { allDay: false, start: '2026-07-01T09:00', end: '2026-07-01T10:00' },
        'Invalid/Zone'
      )
    ).toBeUndefined();
    expect(
      withComposerTimeZone(
        TIMED,
        { allDay: false, start: '', end: '2026-07-01T10:00' },
        'UTC'
      )
    ).toBeUndefined();
  });
});
