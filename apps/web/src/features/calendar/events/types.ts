import type { CalendarAttendee } from '@service-storage/generated/schemas/calendarAttendee';
import type { EventReminders } from '@service-storage/generated/schemas/eventReminders';

/** Supported FullCalendar period views. */
export type CalendarPeriodView =
  | 'dayGridMonth'
  | 'timeGridWeek'
  | 'timeGridDay';

/** The conferencing system backing an event's join URL. */
export type ConferenceProvider = 'google_meet' | 'other';

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
  /**
   * Which conferencing system backs `conferenceUrl`. Only `google_meet` is
   * one Macro can attach and detach; anything else is shown for joining but
   * never rewritten.
   */
  conferenceProvider?: ConferenceProvider;
  /** Event organizer display name. */
  organizerName?: string;
  /** Event organizer email address. */
  organizerEmail?: string;
  /** Attendees and their RSVP metadata. */
  attendees: CalendarAttendee[];
  /** Per-user reminder configuration; absent means the calendar default. */
  reminders?: EventReminders;
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
