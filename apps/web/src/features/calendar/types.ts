import type { EventInput } from '@fullcalendar/core';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import type { CalendarOccurrenceItem } from '@service-storage/generated/schemas/calendarOccurrenceItem';
import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';
import type { EventType } from '@service-storage/generated/schemas/eventType';
import { multiDayTimedDisplayRange } from './utils/calendar-date';
import { canEditCalendarEventTime } from './utils/event-interaction';

/** Supported FullCalendar period views. */
export type CalendarPeriodView =
  | 'dayGridMonth'
  | 'timeGridWeek'
  | 'timeGridDay';

/** The conferencing system backing an event's join URL. */
type ConferenceProvider = 'google_meet' | 'other';

/** Supported first day of the calendar week. */
export type CalendarWeekStart = 0 | 1;

/** Supported calendar time display formats. */
export type CalendarTimeFormat = '12-hour' | '24-hour';

/** A calendar source used to group and style events. */
export interface CalendarSource {
  /** Stable source identifier. */
  id: string;
  /** Human-readable source name. */
  name: string;
  /** Semantic CSS color used for events from this source. */
  color: string;
  /** Connected inbox address, when the source came from a visible calendar. */
  emailAddress?: string;
  /** Whether this source is its connected inbox's primary calendar. */
  isPrimary?: boolean;
}

/** Calendar occurrence data, independent from FullCalendar. */
export interface CalendarEvent {
  /** Stable identifier for this rendered occurrence. */
  id: string;
  /** Stable canonical calendar event identifier. */
  eventId: string;
  /** Stable key for this occurrence within its event. */
  occurrenceKey: string;
  /** Provider recurrence identifier, when applicable. */
  recurrenceId?: string;
  /** Whether this materialized occurrence was cancelled. */
  isCancelled: boolean;
  /** Whether the canonical event source is read-only. */
  isReadOnly: boolean;
  /** Direct conference join URL, when available. */
  conferenceUrl?: string;
  /**
   * Which conferencing system backs `conferenceUrl`. Macro can generate a
   * Google Meet; other conferencing is preserved unless explicitly replaced.
   */
  conferenceProvider?: ConferenceProvider;
  /** Event organizer display name. */
  organizerName?: string;
  /** Event organizer email address. */
  organizerEmail?: string;
  /** Provider-reported creator display name. */
  creatorName?: string;
  /** Provider-reported creator email address. */
  creatorEmail?: string;
  /** Attendees and their RSVP metadata. */
  attendees: CalendarAttendee[];
  /** Per-user reminder configuration; absent means the calendar default. */
  reminders?: EventReminders;
  /** Provider event type; absent means a regular event. */
  eventType?: EventType;
  /** Canonical calendar entity id, for resolving default reminders. */
  calendarId?: string;
  /** Raw recurrence rules attached to the canonical event. */
  recurrenceLines: string[];
  /** Original IANA timezone for a timed occurrence. */
  timeZone?: string;
  /** Event title. */
  title: string;
  /** ISO timestamp or local date string for all-day events. */
  start: string;
  /** Exclusive ISO timestamp or local date string. */
  end: string;
  /** Whether the canonical occurrence is all-day rather than timed. */
  allDay: boolean;
  /** Calendar source that owns the event. */
  calendar: CalendarSource;
  /** Optional event location. */
  location?: string;
  /** Optional event description. */
  description?: string;
}

/** Shared presentation source until calendar/account metadata is exposed. */
export const DEFAULT_CALENDAR_SOURCE: CalendarSource = {
  id: 'calendar',
  name: 'Calendar',
  color: 'var(--color-accent)',
};

function optionalText(value: string | null | undefined) {
  return value ?? undefined;
}

/** Maps one backend occurrence projection into the calendar event model. */
export function mapCalendarOccurrence(
  item: CalendarOccurrenceItem,
  source: CalendarSource = DEFAULT_CALENDAR_SOURCE
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
    conferenceProvider:
      (event.conferenceProvider as ConferenceProvider | null | undefined) ??
      undefined,
    organizerName: event.organizerName ?? undefined,
    organizerEmail: event.organizerEmail ?? undefined,
    creatorName: optionalText(event.creatorName),
    creatorEmail: optionalText(event.creatorEmail),
    attendees: event.attendees ?? [],
    reminders: event.reminders ?? undefined,
    eventType: event.eventType ?? undefined,
    calendarId: event.calendarId ?? undefined,
    timeZone: time.kind === 'timed' ? (time.timeZone ?? undefined) : undefined,
    title: event.title,
    calendar: source,
    location: event.location ?? undefined,
    description: event.description ?? undefined,
  };
}

/** Maps calendar event data into FullCalendar's rendering contract. */
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
    display: 'auto',
    startEditable: interactionEditable,
    durationEditable: interactionEditable,
    extendedProps: {
      calendarEventId: event.id,
    },
  };
}
