import { parseLocalDate } from '@core/util/local-date';
import type { CalendarEvent, CalendarTimeFormat } from '../types';
import { isSameLocalDate, isTimedPointEvent } from './calendar-date';
import {
  formatCompactCalendarTime,
  formatCompactCalendarTimeRange,
} from './time-format';

const formatDate = new Intl.DateTimeFormat(undefined, {
  weekday: 'short',
  month: 'short',
  day: 'numeric',
});
const formatShortDate = new Intl.DateTimeFormat(undefined, {
  month: 'short',
  day: 'numeric',
});

export function parseCalendarDate(value: string) {
  return parseLocalDate(value) ?? new Date(value);
}

export function formatEventSchedule(
  event: Pick<CalendarEvent, 'start' | 'end' | 'allDay'>,
  timeFormat: CalendarTimeFormat
) {
  const start = parseCalendarDate(event.start);
  const end = parseCalendarDate(event.end);

  if (event.allDay) {
    const inclusiveEnd = new Date(end);
    inclusiveEnd.setDate(inclusiveEnd.getDate() - 1);
    return isSameLocalDate(start, inclusiveEnd)
      ? `${formatDate.format(start)} · All day`
      : `${formatShortDate.format(start)} – ${formatShortDate.format(inclusiveEnd)} · All day`;
  }

  if (isTimedPointEvent(event)) {
    return `${formatDate.format(start)} @ ${formatCompactCalendarTime(start, timeFormat)} · No duration`;
  }

  return isSameLocalDate(start, end)
    ? `${formatDate.format(start)} @ ${formatCompactCalendarTimeRange(start, end, timeFormat)}`
    : `${formatDate.format(start)} @ ${formatCompactCalendarTime(start, timeFormat)} – ${formatDate.format(end)} @ ${formatCompactCalendarTime(end, timeFormat)}`;
}
