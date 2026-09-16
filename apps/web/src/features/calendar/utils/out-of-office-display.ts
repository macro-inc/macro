import type { CalendarEvent } from '../types';
import { formatLocalDate, type MultiDayDisplayRange } from './calendar-date';

const atLocalMidnight = (date: Date) =>
  date.getHours() === 0 &&
  date.getMinutes() === 0 &&
  date.getSeconds() === 0 &&
  date.getMilliseconds() === 0;

/**
 * The whole-day date bounds (exclusive end, like {@link MultiDayDisplayRange})
 * of an out-of-office event stored as a full-day timed span, or `undefined`
 * when the event is not one.
 *
 * Google has no date-based out-of-office event, so the composer saves an all-day
 * one as a timed span covering whole days (local midnight to a later local
 * midnight). Keeping the stored event timed preserves its busy time and lets it
 * drag, resize, and sync like any timed event; this recognizes that span so the
 * grid, editor, and details panel can still present it as all-day. The bounds
 * are the viewer's local dates, matching how the calendar renders every event.
 */
export function outOfOfficeAllDayRange(
  event: CalendarEvent
): MultiDayDisplayRange | undefined {
  if (event.eventType !== 'out_of_office' || event.allDay) return undefined;
  const start = new Date(event.start);
  const end = new Date(event.end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    return undefined;
  }
  if (!atLocalMidnight(start) || !atLocalMidnight(end) || end <= start) {
    return undefined;
  }
  return { start: formatLocalDate(start), end: formatLocalDate(end) };
}
