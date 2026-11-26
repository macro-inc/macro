import { formatLocalDate, parseLocalDate } from '@core/util/local-date';
import type { CalendarEvent } from '../types';

/** Projects visible occurrences onto the local days in a six-week mini-month grid. */
export function miniMonthMarkers(
  events: readonly Pick<
    CalendarEvent,
    'allDay' | 'start' | 'end' | 'calendar' | 'isCancelled'
  >[],
  gridStart: Date,
  gridEnd: Date
): ReadonlyMap<string, readonly string[]> {
  const colorsByDay = new Map<string, string[]>();

  for (const event of events) {
    if (event.isCancelled) continue;

    const start = event.allDay
      ? parseLocalDate(event.start)
      : new Date(event.start);
    const end = event.allDay ? parseLocalDate(event.end) : new Date(event.end);
    if (
      !start ||
      !end ||
      !Number.isFinite(start.getTime()) ||
      !Number.isFinite(end.getTime()) ||
      end < start
    )
      continue;

    // Provider ends are exclusive. A timed instant with equal bounds still
    // occupies its start day, while an all-day empty interval occupies none.
    if (event.allDay && end.getTime() === start.getTime()) continue;
    const finalDay = new Date(
      end > start ? end.getTime() - 1 : start.getTime()
    );
    // Clamp by timestamp first, then step by local dates across DST changes.
    const first = start > gridStart ? start : gridStart;
    const day = new Date(
      first.getFullYear(),
      first.getMonth(),
      first.getDate()
    );
    while (day < gridEnd && day <= finalDay) {
      const key = formatLocalDate(day);
      const colors = colorsByDay.get(key) ?? [];
      colors.push(event.calendar.color);
      colorsByDay.set(key, colors);
      day.setDate(day.getDate() + 1);
    }
  }

  return colorsByDay;
}
