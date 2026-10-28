import type { CalendarEvent } from '../../calendar/types';

/** One calendar occurrence, with an optional safe conference link. */
export type UpcomingCalendarEvent = {
  id: string;
  title: string;
  color: string;
  url?: string;
  start: string;
  end: string;
  allDay: boolean;
  eventId: string;
  occurrenceKey: string;
  /** Whether the event is a busy meeting rather than a status or solo block. */
  isMeeting: boolean;
};

/**
 * A meeting is a regular event that shows the viewer as busy and has a call
 * link or someone else invited. Out of office, focus time, birthdays, Gmail
 * reservations, free events, and solo blocks are not meetings.
 */
export function isMeetingEvent(
  event: Pick<CalendarEvent, 'eventType' | 'transparency' | 'attendees'>,
  url: string | undefined
): boolean {
  if (event.eventType !== undefined && event.eventType !== 'default') {
    return false;
  }
  if (event.transparency === 'transparent') return false;
  return Boolean(url) || event.attendees.some((person) => !person.isSelf);
}

function timestamp(value: string, allDay: boolean) {
  return Date.parse(allDay ? `${value}T00:00:00` : value);
}

export function isCalendarEventOngoing(
  event: UpcomingCalendarEvent,
  now: Date
) {
  return (
    timestamp(event.start, event.allDay) <= now.getTime() &&
    now.getTime() < timestamp(event.end, event.allDay)
  );
}

/** Keep ongoing events and distinct recurrence instances, in schedule order. */
export function selectUpcomingCalendarEvents(
  events: readonly UpcomingCalendarEvent[],
  now: Date,
  limit = Number.POSITIVE_INFINITY
): UpcomingCalendarEvent[] {
  const occurrences = new Map<string, UpcomingCalendarEvent>();
  for (const event of events) {
    const start = timestamp(event.start, event.allDay);
    const end = timestamp(event.end, event.allDay);
    if (
      !Number.isFinite(start) ||
      end < start ||
      (event.allDay && end === start) ||
      !(end > now.getTime())
    ) {
      continue;
    }
    occurrences.set(
      JSON.stringify([event.eventId, event.occurrenceKey]),
      event
    );
  }
  return [...occurrences.values()]
    .sort(
      (first, second) =>
        timestamp(first.start, first.allDay) -
          timestamp(second.start, second.allDay) ||
        first.id.localeCompare(second.id)
    )
    .slice(0, limit);
}
