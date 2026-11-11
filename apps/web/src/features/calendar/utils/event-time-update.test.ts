import { describe, expect, it } from 'vitest';
import { RECURRING_EVENT } from '../tests/fixtures';
import { canEditCalendarEventTime } from './event-interaction';
import { calendarEventTimeUpdate } from './event-time-update';

const MOVED_TIME = {
  kind: 'timed',
  startsAt: '2026-11-09T16:00:00Z',
  endsAt: '2026-11-09T17:30:00Z',
  timeZone: 'America/New_York',
} as const;

describe('calendar time edit eligibility', () => {
  it('allows both series occurrences and previously edited exceptions', () => {
    expect(canEditCalendarEventTime(RECURRING_EVENT)).toBe(true);
    expect(
      canEditCalendarEventTime({
        ...RECURRING_EVENT,
        recurrenceLines: [],
        recurrenceId: 'original-start',
      })
    ).toBe(true);
  });
  it.each([
    { isReadOnly: true },
    { isCancelled: true },
    { isSnapshot: true },
    {
      viewerCan: {
        ...RECURRING_EVENT.viewerCan,
        editDetails: false,
        organize: false,
        rsvp: true,
      },
    },
    { teamProjection: { ownerId: 'owner', kind: 'busy' as const } },
    { end: RECURRING_EVENT.start },
  ])('keeps restricted occurrences fixed: %j', (overrides) => {
    expect(canEditCalendarEventTime({ ...RECURRING_EVENT, ...overrides })).toBe(
      false
    );
  });
});

describe('calendar time update requests', () => {
  it('targets only the original occurrence when its time already changed', () => {
    const event = { ...RECURRING_EVENT, recurrenceId: '2026-11-09T14:00:00Z' };
    expect(calendarEventTimeUpdate(event, MOVED_TIME, 'this_event')).toEqual({
      eventId: 'series',
      calendarId: 'calendar',
      scope: 'this_event',
      recurrenceId: event.recurrenceId,
      occurrenceKey: event.occurrenceKey,
      patch: { time: MOVED_TIME },
    });
  });
  it('uses the occurrence key for an unmodified series instance', () => {
    expect(
      calendarEventTimeUpdate(RECURRING_EVENT, MOVED_TIME, 'this_event')
        .recurrenceId
    ).toBe(RECURRING_EVENT.occurrenceKey);
  });
  it('shifts the master time and duration without moving it to the dropped week, across DST', () => {
    expect(calendarEventTimeUpdate(RECURRING_EVENT, MOVED_TIME, 'all')).toEqual(
      {
        eventId: 'series',
        calendarId: 'calendar',
        scope: 'all',
        recurrenceId: undefined,
        occurrenceKey: undefined,
        patch: {
          time: {
            kind: 'timed',
            startsAt: '2026-10-26T15:00:00.000Z',
            endsAt: '2026-10-26T16:30:00.000Z',
            timeZone: 'America/New_York',
          },
        },
      }
    );
  });
  it('resizes the master from its starting edge', () => {
    const request = calendarEventTimeUpdate(
      RECURRING_EVENT,
      {
        ...MOVED_TIME,
        startsAt: '2026-11-09T15:30:00Z',
        endsAt: RECURRING_EVENT.end,
      },
      'all'
    );
    expect(request.patch.time).toMatchObject({
      startsAt: '2026-10-26T14:30:00.000Z',
      endsAt: '2026-10-26T15:00:00.000Z',
    });
  });
  it('moves and resizes all-day series relative to the master date', () => {
    const event = {
      ...RECURRING_EVENT,
      allDay: true,
      start: '2026-11-09',
      occurrenceKey: '2026-11-09',
      end: '2026-11-10',
      seriesTime: {
        kind: 'allDay',
        startDate: '2026-10-26',
        endDate: '2026-10-27',
      } as const,
    };
    expect(
      calendarEventTimeUpdate(
        event,
        { kind: 'allDay', startDate: '2026-11-11', endDate: '2026-11-13' },
        'all'
      ).patch.time
    ).toEqual({
      kind: 'allDay',
      startDate: '2026-10-28',
      endDate: '2026-10-30',
    });
  });
  it('moves explicit weekdays and multiweek boundaries together', () => {
    const event = {
      ...RECURRING_EVENT,
      recurrenceLines: ['RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=MO,WE;COUNT=8'],
    };
    const result = calendarEventTimeUpdate(
      event,
      {
        ...MOVED_TIME,
        startsAt: '2026-11-10T16:00:00Z',
        endsAt: '2026-11-10T17:30:00Z',
      },
      'all'
    );
    expect(result.patch.recurrenceLines).toEqual([
      'RRULE:FREQ=WEEKLY;INTERVAL=2;BYDAY=TU,TH;COUNT=8;WKST=TU',
    ]);
    expect(result.patch.time).toMatchObject({
      startsAt: '2026-10-27T15:00:00.000Z',
      endsAt: '2026-10-27T16:30:00.000Z',
    });
  });
  it.each([
    ['RRULE:FREQ=MONTHLY;BYDAY=1MO'],
    ['RRULE:FREQ=WEEKLY;UNTIL=20261231T235959Z'],
    ['RRULE:FREQ=WEEKLY', 'RDATE:20261201T150000Z'],
    ['RRULE:FREQ=WEEKLY;BYHOUR=10'],
  ])(
    'refuses unsafe series shifts without preventing a single-occurrence edit: %j',
    (...recurrenceLines) => {
      const event = { ...RECURRING_EVENT, recurrenceLines };
      expect(() => calendarEventTimeUpdate(event, MOVED_TIME, 'all')).toThrow(
        'repeat pattern'
      );
      expect(
        calendarEventTimeUpdate(event, MOVED_TIME, 'this_event').patch.time
      ).toEqual(MOVED_TIME);
    }
  );
  it('does not pretend a master update can move an existing time exception', () => {
    const event = { ...RECURRING_EVENT, recurrenceId: '2026-11-09T14:00:00Z' };
    expect(() => calendarEventTimeUpdate(event, MOVED_TIME, 'all')).toThrow(
      'own time'
    );
  });
  it('rejects a new ambiguous master time instead of choosing the wrong fall-back hour', () => {
    const event = {
      ...RECURRING_EVENT,
      occurrenceKey: '2026-11-08T05:30:00Z',
      start: '2026-11-08T05:30:00Z',
      end: '2026-11-08T06:00:00Z',
      seriesTime: {
        kind: 'timed' as const,
        startsAt: '2026-11-01T04:30:00Z',
        endsAt: '2026-11-01T05:00:00Z',
        timeZone: 'America/New_York',
      },
    };
    const time = {
      ...MOVED_TIME,
      startsAt: '2026-11-08T06:30:00Z',
      endsAt: '2026-11-08T07:00:00Z',
    };
    expect(() => calendarEventTimeUpdate(event, time, 'all')).toThrow(
      'daylight-saving'
    );
    expect(
      calendarEventTimeUpdate(event, time, 'this_event').patch.time
    ).toEqual(time);
  });
  it('preserves an unchanged master in the second fall-back hour when resizing its end', () => {
    const event = {
      ...RECURRING_EVENT,
      occurrenceKey: '2026-11-08T06:30:00Z',
      start: '2026-11-08T06:30:00Z',
      end: '2026-11-08T07:30:00Z',
      seriesTime: {
        kind: 'timed' as const,
        startsAt: '2026-11-01T06:30:00Z',
        endsAt: '2026-11-01T07:30:00Z',
        timeZone: 'America/New_York',
      },
    };
    const time = {
      ...MOVED_TIME,
      startsAt: event.start,
      endsAt: '2026-11-08T08:00:00Z',
    };
    expect(
      calendarEventTimeUpdate(event, time, 'all').patch.time
    ).toMatchObject({
      startsAt: '2026-11-01T06:30:00.000Z',
      endsAt: '2026-11-01T08:00:00.000Z',
    });
  });
  it('refuses a move between the two instants with the same fall-back clock time', () => {
    const event = {
      ...RECURRING_EVENT,
      occurrenceKey: '2026-11-01T05:30:00Z',
      start: '2026-11-01T05:30:00Z',
      end: '2026-11-01T07:30:00Z',
      seriesTime: {
        kind: 'timed' as const,
        startsAt: '2026-10-25T05:30:00Z',
        endsAt: '2026-10-25T06:30:00Z',
        timeZone: 'America/New_York',
      },
    };
    const time = {
      ...MOVED_TIME,
      startsAt: '2026-11-01T06:30:00Z',
      endsAt: '2026-11-01T08:30:00Z',
    };
    expect(() => calendarEventTimeUpdate(event, time, 'all')).toThrow(
      'daylight-saving'
    );
    expect(
      calendarEventTimeUpdate(event, time, 'this_event').patch.time
    ).toEqual(time);
  });
  it('uses one wall-clock zone when the provider omits the occurrence and master time zones', () => {
    const event = {
      ...RECURRING_EVENT,
      timeZone: undefined,
      seriesTime: {
        kind: 'timed' as const,
        startsAt: '2026-10-26T14:00:00Z',
        endsAt: '2026-10-26T15:00:00Z',
      },
    };
    const time = { ...MOVED_TIME, timeZone: 'America/Los_Angeles' };
    expect(calendarEventTimeUpdate(event, time, 'all').patch.time).toEqual({
      kind: 'timed',
      startsAt: '2026-10-26T15:00:00.000Z',
      endsAt: '2026-10-26T16:30:00.000Z',
      timeZone: 'America/Los_Angeles',
    });
  });
  it('keeps one-off writes absolute and rejects missing series metadata', () => {
    expect(
      calendarEventTimeUpdate(
        { ...RECURRING_EVENT, recurrenceLines: [] },
        MOVED_TIME,
        'all'
      ).patch.time
    ).toEqual(MOVED_TIME);
    expect(() =>
      calendarEventTimeUpdate(
        { ...RECURRING_EVENT, seriesTime: undefined },
        MOVED_TIME,
        'all'
      )
    ).toThrow('reloaded');
  });
});
