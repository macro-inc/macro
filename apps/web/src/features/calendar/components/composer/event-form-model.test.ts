import { describe, expect, it } from 'vitest';
import type { CalendarEvent, CalendarSource } from '../../types';
import {
  buildEventTime,
  calendarEventToEditorInitialValues,
  defaultEditorInitialValues,
  type EventEditorInitialValues,
  eventHasEnded,
} from './event-form-model';

const NOW = new Date('2026-08-25T12:00:00');

function values(
  overrides: Partial<EventEditorInitialValues>
): EventEditorInitialValues {
  return { ...defaultEditorInitialValues(NOW), ...overrides };
}

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

describe('eventHasEnded', () => {
  it('treats a finished timed range as past', () => {
    expect(
      eventHasEnded(
        values({ start: '2026-08-25T09:00', end: '2026-08-25T10:00' }),
        NOW
      )
    ).toBe(true);
  });

  it('does not flag a range that is still running', () => {
    expect(
      eventHasEnded(
        values({ start: '2026-08-25T11:30', end: '2026-08-25T12:30' }),
        NOW
      )
    ).toBe(false);
  });

  it('does not flag a range that has not started', () => {
    expect(
      eventHasEnded(
        values({ start: '2026-08-26T09:00', end: '2026-08-26T10:00' }),
        NOW
      )
    ).toBe(false);
  });

  it('keeps an all-day event current until its last day is over', () => {
    const today = values({
      allDay: true,
      start: '2026-08-25',
      end: '2026-08-25',
    });
    expect(eventHasEnded(today, NOW)).toBe(false);
    expect(eventHasEnded({ ...today, end: '2026-08-24' }, NOW)).toBe(true);
  });

  it('reports nothing while the range is unparseable', () => {
    expect(eventHasEnded(values({ start: '', end: '' }), NOW)).toBe(false);
    expect(
      eventHasEnded(values({ allDay: true, start: '', end: '' }), NOW)
    ).toBe(false);
  });
});

describe('buildEventTime', () => {
  it('keeps an all-day regular event date-based', () => {
    expect(
      buildEventTime(
        values({ allDay: true, start: '2026-09-17', end: '2026-09-17' })
      )
    ).toEqual({
      kind: 'allDay',
      startDate: '2026-09-17',
      endDate: '2026-09-18',
    });
  });

  it('sends an all-day out-of-office event as a full-day timed span', () => {
    const time = buildEventTime(
      values({
        allDay: true,
        start: '2026-09-17',
        end: '2026-09-17',
        eventType: 'out_of_office',
      })
    );
    expect(time?.kind).toBe('timed');
    if (time?.kind !== 'timed') throw new Error('expected a timed range');
    expect(time.startsAt).toBe(localMidnight('2026-09-17'));
    expect(time.endsAt).toBe(localMidnight('2026-09-18'));
    expect(time.timeZone).toBe(
      Intl.DateTimeFormat().resolvedOptions().timeZone
    );
  });

  it('spans every day of a multi-day all-day out-of-office event', () => {
    const time = buildEventTime(
      values({
        allDay: true,
        start: '2026-09-17',
        end: '2026-09-19',
        eventType: 'out_of_office',
      })
    );
    if (time?.kind !== 'timed') throw new Error('expected a timed range');
    expect(time.startsAt).toBe(localMidnight('2026-09-17'));
    expect(time.endsAt).toBe(localMidnight('2026-09-20'));
  });
});

describe('calendarEventToEditorInitialValues out-of-office round-trip', () => {
  it('shows a full-day timed out-of-office event as all-day', () => {
    const initial = calendarEventToEditorInitialValues(
      calendarEvent({
        eventType: 'out_of_office',
        start: localMidnight('2026-09-17'),
        end: localMidnight('2026-09-19'),
      })
    );
    expect(initial.allDay).toBe(true);
    expect(initial.start).toBe('2026-09-17');
    expect(initial.end).toBe('2026-09-18');
  });

  it('leaves a genuinely timed out-of-office event timed', () => {
    const initial = calendarEventToEditorInitialValues(
      calendarEvent({
        eventType: 'out_of_office',
        start: '2026-09-17T09:00',
        end: '2026-09-17T17:00',
      })
    );
    expect(initial.allDay).toBe(false);
  });
});
