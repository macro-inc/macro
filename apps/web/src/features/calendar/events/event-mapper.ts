import type { EventInput } from '@fullcalendar/core';
import { canEditCalendarEventTime } from './event-interaction';
import { multiDayTimedDisplayRange } from './multi-day-rendering';
import type { CalendarEvent } from './types';

/** Maps calendar-owned event data into FullCalendar's rendering contract. */
export function mapCalendarEventToFullCalendar(
  event: CalendarEvent
): EventInput {
  const timeEditable = canEditCalendarEventTime(event);
  const allDayRange = event.allDay
    ? undefined
    : multiDayTimedDisplayRange(new Date(event.start), new Date(event.end));
  const isRenderedAllDay = event.allDay || allDayRange !== undefined;
  // FullCalendar reports interactions from the all-day row as true all-day
  // ranges. Keep projected timed events fixed so their timestamps are not
  // accidentally replaced with date-only API values.
  const interactionEditable = timeEditable && allDayRange === undefined;

  return {
    id: event.id,
    title: event.title,
    start: allDayRange?.start ?? event.start,
    end: allDayRange?.end ?? event.end,
    allDay: isRenderedAllDay,
    display: 'block',
    startEditable: interactionEditable,
    durationEditable: interactionEditable,
    extendedProps: {
      calendarEventId: event.id,
    },
  };
}
