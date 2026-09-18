import type { CalendarEvent } from '../calendar/types';
import {
  type CalendarEventFilter,
  matchesCalendarEventFilter,
} from '../calendar-home/core/calendar-home';

export function matchesEventFilter(
  event: CalendarEvent,
  filter: CalendarEventFilter,
  viewerEmail?: string
) {
  const filterable = {
    attendees: event.attendees,
    organizerEmail: event.organizerEmail,
    creatorEmail: event.creatorEmail,
  };
  return (
    matchesCalendarEventFilter(filterable, filter, viewerEmail) ||
    matchesCalendarEventFilter(filterable, filter, event.calendar.emailAddress)
  );
}
