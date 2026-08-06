import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { CalendarEvent, CalendarSource } from './types';

/** Shared presentation source until calendar/account metadata is exposed. */
export const DEFAULT_CALENDAR_SOURCE: CalendarSource = {
  id: 'calendar',
  name: 'Calendar',
  color: 'var(--color-accent)',
};

/** Maps one backend occurrence projection into the calendar view model. */
export function mapCalendarOccurrence(
  item: CalendarOccurrenceItem
): CalendarEvent {
  const { event, occurrence } = item;
  const time = occurrence.time;
  const range =
    time.kind === 'timed'
      ? { allDay: false, start: time.startsAt, end: time.endsAt }
      : { allDay: true, start: time.startDate, end: time.endDate };

  return {
    ...range,
    id: JSON.stringify([event.id, occurrence.occurrenceKey]),
    eventId: event.id,
    occurrenceKey: occurrence.occurrenceKey,
    recurrenceId: occurrence.recurrenceId ?? undefined,
    recurrenceLines: event.recurrenceLines ?? [],
    isCancelled: occurrence.isCancelled,
    isReadOnly: event.isReadOnly,
    conferenceUrl: event.conferenceUrl ?? undefined,
    organizerName: event.organizerName ?? undefined,
    organizerEmail: event.organizerEmail ?? undefined,
    attendees: event.attendees ?? [],
    timeZone: time.kind === 'timed' ? (time.timeZone ?? undefined) : undefined,
    title: event.title,
    calendar: DEFAULT_CALENDAR_SOURCE,
    location: event.location ?? undefined,
    description: event.description ?? undefined,
  };
}
