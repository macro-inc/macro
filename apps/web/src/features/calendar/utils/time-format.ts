import {
  CLOCK_FORMAT_OPTIONS,
  formatClockRange,
  formatClockTime,
} from '@app/components/date-time-range/clock-format';
import type { CalendarTimeFormat } from '../types';

/** FullCalendar and Intl options for the supported calendar time formats. */
export const CALENDAR_TIME_FORMAT_OPTIONS = CLOCK_FORMAT_OPTIONS;

/** Returns the time format that matches the user's current locale. */
export function getDefaultCalendarTimeFormat(): CalendarTimeFormat {
  return new Intl.DateTimeFormat(undefined, {
    hour: 'numeric',
  }).resolvedOptions().hour12 === false
    ? '24-hour'
    : '12-hour';
}

/** Formats a time using the calendar's selected 12/24-hour preference. */
export function formatCalendarTime(date: Date, timeFormat: CalendarTimeFormat) {
  return formatClockTime(date, timeFormat);
}

/** Formats event-card times compactly while preserving the selected clock. */
export function formatCompactCalendarTime(
  date: Date,
  timeFormat: CalendarTimeFormat,
  showDayPeriod = true
) {
  return formatClockTime(date, timeFormat, true, showDayPeriod);
}

/** Formats an event-card range without repeating a shared AM/PM marker. */
export function formatCompactCalendarTimeRange(
  start: Date,
  end: Date,
  timeFormat: CalendarTimeFormat,
  separator = ' – '
) {
  return formatClockRange(start, end, timeFormat, separator);
}
