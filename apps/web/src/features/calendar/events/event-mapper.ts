import type { EventInput } from '@fullcalendar/core';
import { canEditCalendarEventTime } from './event-interaction';
import type { CalendarEvent } from './types';

/** Maps calendar-owned event data into FullCalendar's rendering contract. */
export function mapCalendarEventToFullCalendar(
  event: CalendarEvent
): EventInput {
  const timeEditable = canEditCalendarEventTime(event);

  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    display: 'block',
    startEditable: timeEditable,
    durationEditable: timeEditable,
    extendedProps: {
      calendarEventId: event.id,
    },
  };
}
