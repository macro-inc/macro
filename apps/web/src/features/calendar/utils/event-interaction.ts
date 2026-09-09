import type { EventApi } from '@fullcalendar/core';
import type { EventTime } from '@service-email/generated/schemas/eventTime';
import type { CalendarEvent } from '../types';
import { formatLocalDate } from './calendar-date';

interface FullCalendarEventRange {
  allDay: boolean;
  end: Date | null;
  start: Date | null;
}

/** Resolves the occurrence id retained in FullCalendar's interaction copies. */
export function calendarEventRenderId(
  event: Pick<EventApi, 'extendedProps' | 'id'>
) {
  const calendarEventId = event.extendedProps.calendarEventId;
  return typeof calendarEventId === 'string' ? calendarEventId : event.id;
}

/**
 * Every occurrence id a rendered bar stands in for. A merged working-location
 * run covers several days, only one of which has a chip, so selection, focus,
 * and chip registration key off all of them.
 */
export function calendarEventRenderIds(
  event: Pick<EventApi, 'extendedProps' | 'id'>
): string[] {
  const merged = event.extendedProps.mergedOccurrenceIds;
  return Array.isArray(merged) && merged.length > 0
    ? merged
    : [calendarEventRenderId(event)];
}

/** Whether an occurrence can safely be moved or resized from the calendar. */
export function canEditCalendarEventTime(event: CalendarEvent) {
  return (
    !event.isReadOnly &&
    !event.isCancelled &&
    event.recurrenceLines.length === 0 &&
    event.recurrenceId === undefined
  );
}

/** Converts FullCalendar's post-interaction range into the update API shape. */
export function calendarEventTimeFromFullCalendar(
  event: FullCalendarEventRange,
  original: Pick<CalendarEvent, 'timeZone'>
): EventTime | undefined {
  const { start, end } = event;
  if (!start || !end || end <= start) return undefined;

  if (event.allDay) {
    const startDate = formatLocalDate(start);
    const endDate = formatLocalDate(end);
    if (endDate <= startDate) return undefined;

    return { kind: 'allDay', startDate, endDate };
  }

  return {
    kind: 'timed',
    startsAt: start.toISOString(),
    endsAt: end.toISOString(),
    timeZone:
      original.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
  };
}

/** Minimal FullCalendar change payload shared by drop and resize callbacks. */
export interface CalendarEventTimeChange {
  event: EventApi;
  revert: () => void;
}
