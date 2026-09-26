import { describe, expect, it } from 'vitest';
import {
  isCalendarEventOngoing,
  selectUpcomingCalendarEvents,
  type UpcomingCalendarEvent,
} from './upcoming-calendar-events';

const call = (hour: number): UpcomingCalendarEvent => ({
  id: `call-${hour}`,
  eventId: 'recurring-event',
  occurrenceKey: `occurrence-${hour}`,
  title: 'Planning',
  url: 'https://meet.google.com/one-room',
  start: `2026-09-23T${hour}:00:00Z`,
  end: `2026-09-23T${hour + 1}:00:00Z`,
  allDay: false,
});

describe('upcoming calendar calls', () => {
  it('keeps ordinary events without a meeting link and uses exact ongoing boundaries', () => {
    const event = { ...call(13), url: undefined };
    expect(
      selectUpcomingCalendarEvents([event], new Date('2026-09-23T12:00:00Z'))
    ).toEqual([event]);
    expect(
      isCalendarEventOngoing(event, new Date('2026-09-23T12:59:59Z'))
    ).toBe(false);
    expect(isCalendarEventOngoing(event, new Date(event.start))).toBe(true);
    expect(isCalendarEventOngoing(event, new Date(event.end))).toBe(false);
  });
  it('sorts before limiting and keeps an ongoing call until its end', () => {
    expect(
      selectUpcomingCalendarEvents(
        [call(18), call(17), call(16), call(15), call(14), call(13), call(12)],
        new Date('2026-09-23T13:30:00Z'),
        5
      ).map((item) => item.id)
    ).toEqual(['call-13', 'call-14', 'call-15', 'call-16', 'call-17']);
    expect(
      selectUpcomingCalendarEvents([call(13)], new Date(call(13).end))
    ).toEqual([]);
  });

  it('deduplicates overlapping windows without merging recurring calls sharing a URL', () => {
    const first = call(13);
    expect(
      selectUpcomingCalendarEvents(
        [first, call(14), { ...first, title: 'Updated planning' }],
        new Date('2026-09-23T12:00:00Z')
      )
    ).toEqual([{ ...first, title: 'Updated planning' }, call(14)]);
  });

  it('uses exclusive local date boundaries for all-day calls', () => {
    const allDay = {
      ...call(13),
      start: '2026-09-23',
      end: '2026-09-24',
      allDay: true,
    };
    expect(
      selectUpcomingCalendarEvents([allDay], new Date(2026, 8, 23, 23, 59))
    ).toEqual([allDay]);
    expect(
      selectUpcomingCalendarEvents([allDay], new Date(2026, 8, 24))
    ).toEqual([]);
  });

  it('ignores invalid dates and reversed time ranges', () => {
    expect(
      selectUpcomingCalendarEvents(
        [
          { ...call(13), start: 'invalid' },
          { ...call(14), end: 'invalid' },
          { ...call(15), end: call(13).end },
        ],
        new Date('2026-09-23T12:00:00Z')
      )
    ).toEqual([]);
  });
});
