import type { EventInput } from '@fullcalendar/core';
import { canEditCalendarEventTime } from './event-interaction';
import type { CalendarEvent } from './types';

function formatLocalDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

function isSameLocalDate(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

function renderedAllDayRange(event: CalendarEvent) {
  if (event.allDay) return undefined;

  const start = new Date(event.start);
  const end = new Date(event.end);
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return undefined;
  }

  // Event ends are exclusive. Looking at the final occupied instant avoids
  // adding an extra day when an event ends exactly at local midnight.
  const finalOccupiedInstant = new Date(end.getTime() - 1);
  if (isSameLocalDate(start, finalOccupiedInstant)) return undefined;

  const exclusiveEnd = new Date(
    finalOccupiedInstant.getFullYear(),
    finalOccupiedInstant.getMonth(),
    finalOccupiedInstant.getDate() + 1
  );

  return {
    start: formatLocalDate(start),
    end: formatLocalDate(exclusiveEnd),
  };
}

/** Maps calendar-owned event data into FullCalendar's rendering contract. */
export function mapCalendarEventToFullCalendar(
  event: CalendarEvent
): EventInput {
  const timeEditable = canEditCalendarEventTime(event);
  const allDayRange = renderedAllDayRange(event);
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
