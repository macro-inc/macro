import type { CalendarOccurrenceQueryRange } from '@queries/calendar/occurrences';

const CALENDAR_HISTORY_DAYS = 364;
const CALENDAR_FUTURE_DAYS = 729;

interface CalendarSupportedRange {
  start: Date;
  end: Date;
}

/** Returns a safely inset version of the backend's rolling materialized range. */
function getCalendarSupportedRange(now = new Date()): CalendarSupportedRange {
  const start = new Date(now);
  start.setDate(start.getDate() - CALENDAR_HISTORY_DAYS);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setDate(end.getDate() + CALENDAR_FUTURE_DAYS);
  end.setHours(0, 0, 0, 0);

  return { start, end };
}

/** Returns whether the complete viewport can be served by the backend. */
export function isCalendarRangeSupported(
  range: CalendarOccurrenceQueryRange,
  now = new Date()
) {
  const supportedRange = getCalendarSupportedRange(now);
  const start = new Date(range.start);
  const end = new Date(range.end);

  return (
    !Number.isNaN(start.getTime()) &&
    !Number.isNaN(end.getTime()) &&
    start >= supportedRange.start &&
    end <= supportedRange.end
  );
}
