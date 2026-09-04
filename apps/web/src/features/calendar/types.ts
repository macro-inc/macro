import type { EventInput } from '@fullcalendar/core';
import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import type { CalendarEvent as CalendarEventEntity } from '@service-storage/generated/schemas/calendarEvent';
import type { CalendarEventSourceContent } from '@service-storage/generated/schemas/calendarEventSourceContent';
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
  /** Connected inbox link that syncs this calendar, for grouping by account. */
  emailLinkId?: string;
  /** Whether this source is its connected inbox's primary calendar. */
  isPrimary?: boolean;
  /** Whether this is a subscribed system calendar (holidays, birthdays). */
  isSubscription?: boolean;
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
  /** Whether the displayed copy's calendar prohibits editing it. */
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
  /**
   * Calendar of the displayed copy: the first visible one of the event's
   * copies, preferring the primary. Mutations address this copy, and its
   * calendar's defaults resolve the event's reminders.
   */
  calendarId?: string;
  /**
   * Every visible calendar this event is synced from. A shared calendar can
   * re-import an event a member also owns, so one event belongs to several
   * calendars at once and stays visible while any of them is shown.
   */
  sourceCalendarIds: string[];
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

/** How an occurrence is attributed to the calendars the viewer is showing. */
export interface CalendarOccurrenceMappingOptions {
  sourceById?: ReadonlyMap<string, CalendarSource>;
  isSourceVisible?: (sourceId: string) => boolean;
}

/**
 * The copy of an event to display: the first copy whose calendar is shown,
 * in the server's canonical-first order (primary calendar, then freshest),
 * falling back to the canonical copy when none of them is shown.
 */
export function selectEventSource(
  event: Pick<CalendarEventEntity, 'sources'>,
  isSourceVisible?: (sourceId: string) => boolean
): CalendarEventSourceContent | undefined {
  const sources = event.sources ?? [];
  return (
    sources.find((source) => isSourceVisible?.(source.calendarId) !== false) ??
    sources[0]
  );
}

/**
 * Whether an event renders under a per-source visibility predicate: it
 * stays visible while any of its calendars is shown. The displayed calendar
 * is the fallback for events without copy data.
 */
export function isCalendarEventVisible(
  event: Pick<CalendarEvent, 'calendar' | 'sourceCalendarIds'>,
  isSourceVisible: (sourceId: string) => boolean
): boolean {
  const sourceIds =
    event.sourceCalendarIds.length > 0
      ? event.sourceCalendarIds
      : [event.calendar.id];
  return sourceIds.some((id) => isSourceVisible(id));
}

/**
 * Maps one backend occurrence projection into the calendar event model,
 * showing the copy that belongs to a calendar the viewer has on. The entity
 * itself carries the canonical copy's content, so an event with no copy
 * data reads the same as its first copy.
 */
export function mapCalendarOccurrence(
  item: CalendarOccurrenceItem,
  options: CalendarOccurrenceMappingOptions = {}
): CalendarEvent {
  const { event, occurrence } = item;
  const time = occurrence.time;
  const range =
    time.kind === 'timed'
      ? { allDay: false, start: time.startsAt, end: time.endsAt }
      : { allDay: true, start: time.startDate, end: time.endDate };
  const selected = selectEventSource(event, options.isSourceVisible);
  const content = selected ?? event;
  const calendarId = selected?.calendarId ?? event.calendarId ?? undefined;
  const source =
    (calendarId ? options.sourceById?.get(calendarId) : undefined) ??
    DEFAULT_CALENDAR_SOURCE;

  return {
    ...range,
    id: JSON.stringify([event.id, occurrence.occurrenceKey]),
    eventId: event.id,
    occurrenceKey: occurrence.occurrenceKey,
    recurrenceId: occurrence.recurrenceId ?? undefined,
    recurrenceLines: event.recurrenceLines ?? [],
    isCancelled: occurrence.isCancelled,
    isReadOnly: content.isReadOnly,
    conferenceUrl: event.conferenceUrl ?? undefined,
    conferenceProvider:
      (event.conferenceProvider as ConferenceProvider | null | undefined) ??
      undefined,
    organizerName: event.organizerName ?? undefined,
    organizerEmail: event.organizerEmail ?? undefined,
    creatorName: optionalText(content.creatorName),
    creatorEmail: optionalText(content.creatorEmail),
    attendees: event.attendees ?? [],
    reminders: content.reminders ?? undefined,
    eventType: content.eventType ?? undefined,
    calendarId,
    sourceCalendarIds: (event.sources ?? []).map((copy) => copy.calendarId),
    timeZone: time.kind === 'timed' ? (time.timeZone ?? undefined) : undefined,
    title: content.title,
    calendar: source,
    location: content.location ?? undefined,
    description: content.description ?? undefined,
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
    // FullCalendar re-applies the calendar color only when an event remounts,
    // so a chip that switches to another copy (its calendar was hidden) keys
    // a fresh event; extendedProps keeps the stable occurrence id.
    id: JSON.stringify([event.id, event.calendar.id, event.calendar.color]),
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
