import { describe, expect, it } from 'vitest';
import {
  buildEventTime,
  calendarSelectionToEditorInitialValues,
  convertTimesForAllDay,
  type EventEditorInitialValues,
  moveAllDayRange,
} from './event-form-model';

const timedValues = (): EventEditorInitialValues => ({
  title: 'Planning',
  allDay: false,
  start: '2026-04-08T09:00',
  end: '2026-04-08T10:30',
  recurrenceLines: [],
  calendarId: 'calendar-1',
  guests: '',
  location: '',
  description: '',
});

describe('event form model', () => {
  it('converts FullCalendar all-day selections to inclusive form dates', () => {
    const values = calendarSelectionToEditorInitialValues({
      start: new Date(2026, 3, 8),
      end: new Date(2026, 3, 11),
      allDay: true,
    });

    expect(values).toMatchObject({
      allDay: true,
      start: '2026-04-08',
      end: '2026-04-10',
    });
  });

  it('converts inclusive all-day form dates to an exclusive API end', () => {
    expect(
      buildEventTime({
        ...timedValues(),
        allDay: true,
        start: '2026-04-08',
        end: '2026-04-10',
      })
    ).toEqual({
      kind: 'allDay',
      startDate: '2026-04-08',
      endDate: '2026-04-11',
    });
  });

  it('preserves an all-day range duration when its start moves', () => {
    expect(
      moveAllDayRange(
        {
          ...timedValues(),
          allDay: true,
          start: '2026-04-08',
          end: '2026-04-10',
        },
        '2026-05-01'
      )
    ).toMatchObject({ start: '2026-05-01', end: '2026-05-03' });
  });

  it('switches timed values to their local date representation', () => {
    expect(convertTimesForAllDay(timedValues(), true)).toMatchObject({
      allDay: true,
      start: '2026-04-08',
      end: '2026-04-08',
    });
  });
});
