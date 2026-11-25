const CALENDAR_HISTORY_DAYS = 364;
const CALENDAR_FUTURE_DAYS = 729;

interface CalendarSupportedRange {
  start: Date;
  end: Date;
}

/** Returns a safely inset version of the backend's rolling materialized range. */
export function getCalendarSupportedRange(
  now = new Date()
): CalendarSupportedRange {
  const start = new Date(now);
  start.setDate(start.getDate() - CALENDAR_HISTORY_DAYS);
  start.setHours(0, 0, 0, 0);

  const end = new Date(now);
  end.setDate(end.getDate() + CALENDAR_FUTURE_DAYS);
  end.setHours(0, 0, 0, 0);

  return { start, end };
}

/** Clip a larger display window while retaining the supported dates it contains. */
export function clipCalendarDisplayRange(
  start: Date,
  end: Date,
  now = new Date()
) {
  const supported = getCalendarSupportedRange(now);
  const first = start < supported.start ? supported.start : start;
  const last = end > supported.end ? supported.end : end;
  return first < last ? { start: first, end: last } : undefined;
}

/** Returns whether the complete viewport can be served by the backend. */
export function isCalendarRangeSupported(
  range: { start: string | Date; end: string | Date },
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
