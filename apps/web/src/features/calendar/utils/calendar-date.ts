import { formatLocalDate } from '@core/util/local-date';

/** The exclusive local-date range used to render a multi-day timed span. */
export interface MultiDayDisplayRange {
  start: string;
  end: string;
}

/** Whether two dates fall on the same local calendar day. */
export function isSameLocalDate(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
}

/** An imported timed instant has no duration; all-day dates remain intervals. */
export function isTimedPointEvent(event: {
  allDay: boolean;
  start: string;
  end: string;
}): boolean {
  if (event.allDay) return false;
  const start = Date.parse(event.start);
  return Number.isFinite(start) && start === Date.parse(event.end);
}

/**
 * Projects a timed span that occupies multiple local dates into date-only
 * bounds suitable for FullCalendar's all-day row.
 */
export function multiDayTimedDisplayRange(
  start: Date,
  end: Date
): MultiDayDisplayRange | undefined {
  if (
    Number.isNaN(start.getTime()) ||
    Number.isNaN(end.getTime()) ||
    end <= start
  ) {
    return undefined;
  }

  // Event ends are exclusive. Looking at the final occupied instant avoids
  // adding an extra day when a span ends exactly at local midnight.
  const finalOccupiedInstant = new Date(end.getTime() - 1);
  if (isSameLocalDate(start, finalOccupiedInstant)) return undefined;

  const exclusiveEnd = new Date(
    finalOccupiedInstant.getFullYear(),
    finalOccupiedInstant.getMonth(),
    finalOccupiedInstant.getDate() + 1
  );

  return {
    start: formatLocalDate(start),
    end: formatLocalDate(exclusiveEnd),
  };
}
