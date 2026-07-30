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

/** Calendar-owned event data, independent from FullCalendar. */
export interface CalendarEvent {
  /** Stable event identifier. */
  id: string;
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
