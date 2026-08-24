import { parseLocalDate } from '@app/features/calendar/utils/calendar-date';
import {
  type CalendarOccurrenceQueryRange,
  createCalendarOccurrenceQueryRange,
} from '@queries/calendar/occurrences';

/** Event timing fields available to calendar navigation call sites. */
export type CalendarBlockEventTime =
  | { kind: 'timed'; startsAt: string; endsAt?: string }
  | { kind: 'allDay'; startDate: string; endDate?: string };

function nextLocalDay(date: Date) {
  const next = new Date(date);
  next.setDate(next.getDate() + 1);
  return next;
}

/**
 * Builds a complete occurrence-query range around an event. Timed events are
 * expanded to local-day boundaries so both UTC and date-only API boundaries
 * remain non-empty and can also match all-day projections.
 */
export function createCalendarBlockRange(
  time: CalendarBlockEventTime
): CalendarOccurrenceQueryRange | undefined {
  if (time.kind === 'allDay') {
    const start = parseLocalDate(time.startDate);
    if (!start) return undefined;

    const parsedEnd = time.endDate ? parseLocalDate(time.endDate) : undefined;
    const end =
      parsedEnd && parsedEnd > start ? parsedEnd : nextLocalDay(start);
    return createCalendarOccurrenceQueryRange(start, end);
  }

  const startsAt = new Date(time.startsAt);
  if (!Number.isFinite(startsAt.getTime())) return undefined;

  const start = new Date(startsAt);
  start.setHours(0, 0, 0, 0);

  const parsedEnd = time.endsAt ? new Date(time.endsAt) : undefined;
  const eventEnd =
    parsedEnd && Number.isFinite(parsedEnd.getTime()) && parsedEnd > startsAt
      ? parsedEnd
      : startsAt;
  const end = new Date(eventEnd);
  const endsAtLocalMidnight =
    end.getHours() === 0 &&
    end.getMinutes() === 0 &&
    end.getSeconds() === 0 &&
    end.getMilliseconds() === 0;
  end.setHours(0, 0, 0, 0);
  if (!endsAtLocalMidnight || end <= start) {
    end.setDate(end.getDate() + 1);
  }

  return createCalendarOccurrenceQueryRange(start, end);
}

/** Whether a runtime value is a complete, non-empty occurrence query range. */
export function isCalendarBlockRange(
  value: unknown
): value is CalendarOccurrenceQueryRange {
  if (!value || typeof value !== 'object') return false;
  const range = value as Partial<CalendarOccurrenceQueryRange>;
  if (
    typeof range.start !== 'string' ||
    typeof range.end !== 'string' ||
    typeof range.startDate !== 'string' ||
    typeof range.endDate !== 'string'
  ) {
    return false;
  }

  const start = new Date(range.start);
  const end = new Date(range.end);
  return (
    Number.isFinite(start.getTime()) &&
    Number.isFinite(end.getTime()) &&
    start < end &&
    parseLocalDate(range.startDate) !== undefined &&
    parseLocalDate(range.endDate) !== undefined &&
    range.startDate < range.endDate
  );
}
