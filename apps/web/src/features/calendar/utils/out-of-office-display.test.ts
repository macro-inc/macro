import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarSource } from '../types';
import { outOfOfficeAllDayRange } from './out-of-office-display';

const CALENDAR: CalendarSource = { id: 'cal-1', name: 'Work', color: 'blue' };

function calendarEvent(overrides: Partial<CalendarEvent>): CalendarEvent {
  return {
    id: 'evt-1',
    eventId: 'evt-1',
    occurrenceKey: 'evt-1',
    isCancelled: false,
    isReadOnly: false,
    attendees: [],
    recurrenceLines: [],
    sourceCalendarIds: [],
    title: 'Away',
    start: '2026-09-17T00:00:00.000Z',
    end: '2026-09-18T00:00:00.000Z',
    allDay: false,
    calendar: CALENDAR,
    visibleCalendars: [CALENDAR],
    ...overrides,
  };
}

/** Local midnight of a `yyyy-MM-dd` date as a UTC ISO instant. */
function localMidnight(date: string): string {
  return new Date(`${date}T00:00`).toISOString();
}

describe('outOfOfficeAllDayRange', () => {
  it('recognizes a full-day out-of-office span as whole local days', () => {
    expect(
      outOfOfficeAllDayRange(
        calendarEvent({
          eventType: 'out_of_office',
          start: localMidnight('2026-09-17'),
          end: localMidnight('2026-09-19'),
        })
      )
    ).toEqual({ start: '2026-09-17', end: '2026-09-19' });
  });

  it('ignores a genuinely timed out-of-office event', () => {
    expect(
      outOfOfficeAllDayRange(
        calendarEvent({
          eventType: 'out_of_office',
          start: '2026-09-17T09:00',
          end: '2026-09-17T17:00',
        })
      )
    ).toBeUndefined();
  });

  it('ignores a full-day span that is not out of office', () => {
    expect(
      outOfOfficeAllDayRange(
        calendarEvent({
          eventType: undefined,
          start: localMidnight('2026-09-17'),
          end: localMidnight('2026-09-18'),
        })
      )
    ).toBeUndefined();
  });

  it('ignores an event already marked all-day', () => {
    expect(
      outOfOfficeAllDayRange(
        calendarEvent({
          eventType: 'out_of_office',
          allDay: true,
          start: '2026-09-17',
          end: '2026-09-18',
        })
      )
    ).toBeUndefined();
  });
});
