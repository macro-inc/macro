import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';

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
  /** Event organizer display name. */
  organizerName?: string;
  /** Event organizer email address. */
  organizerEmail?: string;
  /** Attendees and their RSVP metadata. */
  attendees: CalendarAttendee[];
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
  /** Whether the event occupies the all-day area. */
  allDay: boolean;
  /** Calendar source that owns the event. */
  calendar: CalendarSource;
  /** Optional event location. */
  location?: string;
  /** Optional event description. */
  description?: string;
}
