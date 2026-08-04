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
  /** Whether the canonical event source is read-only. */
  isReadOnly: boolean;
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
