import type { CalendarTimeFormat } from './events/types';

/** FullCalendar and Intl options for the supported calendar time formats. */
export const CALENDAR_TIME_FORMAT_OPTIONS = {
  '12-hour': {
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  },
  '24-hour': {
    hour: 'numeric',
    minute: '2-digit',
    hour12: false,
  },
} satisfies Record<CalendarTimeFormat, Intl.DateTimeFormatOptions>;

const calendarTimeFormatters = {
  '12-hour': new Intl.DateTimeFormat(
    undefined,
    CALENDAR_TIME_FORMAT_OPTIONS['12-hour']
  ),
  '24-hour': new Intl.DateTimeFormat(
    undefined,
    CALENDAR_TIME_FORMAT_OPTIONS['24-hour']
  ),
} satisfies Record<CalendarTimeFormat, Intl.DateTimeFormat>;

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
  return calendarTimeFormatters[timeFormat].format(date);
}
