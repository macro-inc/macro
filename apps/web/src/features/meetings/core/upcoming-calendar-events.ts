/** One calendar occurrence, with an optional safe conference link. */
export type UpcomingCalendarEvent = {
  id: string;
  title: string;
  url?: string;
  start: string;
  end: string;
  allDay: boolean;
  eventId: string;
  occurrenceKey: string;
};

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
    if (!Number.isFinite(start) || end <= start || !(end > now.getTime())) {
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
