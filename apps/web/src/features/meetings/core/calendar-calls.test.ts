import { describe, expect, it } from 'vitest';
import {
  buildCalendarCallItems,
  type CalendarCallEvent,
  type CalendarCallLink,
  type CalendarCallRecord,
  calendarCallCanJoin,
  calendarCallDate,
  calendarCallDuration,
  calendarCallNavigation,
  calendarCallTime,
  groupCalendarCallsByDay,
} from './calendar-calls';

const now = Date.parse('2026-09-18T12:00:00Z');
const link: CalendarCallLink = {
  id: 'meeting-1',
  title: 'Instant review',
  url: 'https://macro.com/app/meet/token-1234567890123456',
};
const event: CalendarCallEvent = {
  eventId: 'event-1',
  occurrenceKey: '2026-09-20T12:00:00Z',
  title: 'Scheduled review',
  start: '2026-09-20T12:00:00Z',
  end: '2026-09-20T12:30:00Z',
  url: link.url,
  attendees: [],
};
const record: CalendarCallRecord = {
  id: 'call-1',
  title: 'Review recording',
  startedAt: '2026-09-17T12:00:00Z',
  active: false,
  people: ['Taylor'],
  status: 'ATTENDED',
};

describe('calendar calls model', () => {
  it('offers Join only during the scheduled time window', () => {
    const [item] = buildCalendarCallItems([], [event], [], now);
    expect(
      calendarCallCanJoin(item, new Date(Date.parse(event.start) - 1))
    ).toBe(false);
    expect(calendarCallCanJoin(item, new Date(event.start))).toBe(true);
    expect(calendarCallCanJoin(item, new Date(Date.parse(event.end) - 1))).toBe(
      true
    );
    expect(calendarCallCanJoin(item, new Date(event.end))).toBe(false);
  });
  it('does not treat an archived meeting session as live', () => {
    const [item] = buildCalendarCallItems(
      [
        {
          ...link,
          callId: record.id,
          start: record.startedAt,
          end: record.startedAt,
        },
      ],
      [],
      [record],
      now
    );
    expect(item.group).toBe('recent');
    expect(calendarCallCanJoin(item, new Date(now))).toBe(false);
    const [active] = buildCalendarCallItems(
      [],
      [],
      [{ ...record, active: true }],
      now
    );
    expect(calendarCallCanJoin(active, new Date(now))).toBe(true);
    const [idle] = buildCalendarCallItems([link], [], [], now);
    expect(calendarCallCanJoin(idle, new Date(now))).toBe(false);
  });
  it('uses local day boundaries for joining all-day scheduled calls', () => {
    const [item] = buildCalendarCallItems(
      [],
      [{ ...event, allDay: true, start: '2026-09-20', end: '2026-09-21' }],
      [],
      now
    );
    expect(calendarCallCanJoin(item, new Date(2026, 8, 19, 23, 59))).toBe(
      false
    );
    expect(calendarCallCanJoin(item, new Date(2026, 8, 20, 0, 0))).toBe(true);
    expect(calendarCallCanJoin(item, new Date(2026, 8, 21, 0, 0))).toBe(false);
  });
  it('groups calendar rows by local day, keeps all-day dates, and formats their duration', () => {
    const now = new Date(2026, 8, 20, 10);
    const items = buildCalendarCallItems(
      [],
      [
        {
          ...event,
          start: new Date(2026, 8, 20, 15).toISOString(),
          end: new Date(2026, 8, 20, 15, 45).toISOString(),
        },
        {
          ...event,
          eventId: 'tomorrow',
          start: '2026-09-21',
          end: '2026-09-22',
          allDay: true,
        },
      ],
      [],
      now.getTime()
    );
    expect(
      groupCalendarCallsByDay(items, now).map((group) => group.label)
    ).toEqual(['Today', 'Tomorrow']);
    expect(calendarCallDuration(items[0])).toBe('45 min');
    expect(calendarCallTime(items[1])).toBe('All day');
  });
  it('keeps instant links off the calendar and historical sessions in a separate group', () => {
    const items = buildCalendarCallItems([link], [], [record], now);
    expect(items.map((item) => item.group)).toEqual(['instant', 'recent']);
    expect(items[0].event).toBeUndefined();
    expect(items[1].link).toBeUndefined();
  });

  it('merges a meeting, its calendar occurrence, and its live record without duplicate rows', () => {
    const items = buildCalendarCallItems(
      [{ ...link, callId: record.id, start: event.start }],
      [
        {
          ...event,
          url: 'https://dev.macro.com/app/meet/token-1234567890123456/',
        },
      ],
      [{ ...record, active: true }],
      now
    );
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      group: 'live',
      title: event.title,
      event: { eventId: event.eventId },
      record: { id: record.id },
    });
  });

  it('includes invited calendar calls without exposing owner link-management actions', () => {
    const [item] = buildCalendarCallItems([], [event], [], now);
    expect(item.group).toBe('scheduled');
    expect(item.event).toEqual(event);
    expect(item.link).toBeUndefined();
  });

  it('keeps an external conference separate from a Macro link with the same path', () => {
    const items = buildCalendarCallItems(
      [link],
      [
        {
          ...event,
          external: true,
          url: 'https://example.com/app/meet/token-1234567890123456',
        },
      ],
      [],
      now
    );
    expect(items).toHaveLength(2);
    expect(items.find((item) => item.event)?.link).toBeUndefined();
  });

  it('preserves individual recurring occurrences and sends expired schedules to recent calls', () => {
    const past = {
      ...event,
      start: '2026-09-17T12:00:00Z',
      end: '2026-09-17T12:30:00Z',
      occurrenceKey: 'past',
    };
    const items = buildCalendarCallItems(
      [{ ...link, start: past.start, end: past.end }],
      [event, past],
      [],
      now
    );
    expect(items).toHaveLength(2);
    expect(items.map((item) => item.group)).toEqual(['scheduled', 'recent']);
    expect(items[0].event?.occurrenceKey).toBe(event.occurrenceKey);
    expect(items[1].event?.occurrenceKey).toBe('past');
  });

  it('formats all-day dates without shifting them through the event timezone', () => {
    expect(calendarCallDate('2026-09-20', 'Pacific/Honolulu', true)).toContain(
      '20'
    );
    expect(calendarCallDate('invalid')).toBeUndefined();
  });

  it('keeps an all-day call scheduled until its local exclusive end date', () => {
    const allDay = {
      ...event,
      allDay: true,
      start: '2026-09-18',
      end: '2026-09-19',
    };
    expect(
      buildCalendarCallItems(
        [],
        [allDay],
        [],
        new Date(2026, 8, 18, 23, 30).getTime()
      )[0].group
    ).toBe('scheduled');
    expect(
      buildCalendarCallItems(
        [],
        [allDay],
        [],
        new Date(2026, 8, 19, 0, 0).getTime()
      )[0].group
    ).toBe('recent');
  });

  it('preserves a different environment host when joining a calendar invitation', () => {
    expect(
      calendarCallNavigation(
        'https://macro.com/app/meet/secret',
        'https://dev.macro.com'
      )
    ).toEqual({ kind: 'external', url: 'https://macro.com/app/meet/secret' });
    expect(
      calendarCallNavigation(
        'https://dev.macro.com/app/meet/secret?join=true',
        'https://dev.macro.com'
      )
    ).toEqual({ kind: 'internal', path: '/meet/secret?join=true' });
    expect(
      calendarCallNavigation('/meet/secret', 'http://localhost:3005')
    ).toEqual({ kind: 'internal', path: '/meet/secret' });
  });
});
