import type { EventInput } from '@fullcalendar/core';
import type { CalendarEvent } from './types';

/** Maps calendar-owned event data into FullCalendar's rendering contract. */
export function mapCalendarEventToFullCalendar(
  event: CalendarEvent
): EventInput {
  const eventBackground = `color-mix(in oklch, ${event.calendar.color} 5%, var(--color-surface))`;

  return {
    id: event.id,
    title: event.title,
    start: event.start,
    end: event.end,
    allDay: event.allDay,
    backgroundColor: eventBackground,
    borderColor: event.calendar.color,
    textColor: event.calendar.color,
    display: 'block',
    extendedProps: {
      calendarEventId: event.id,
    },
  };
}
