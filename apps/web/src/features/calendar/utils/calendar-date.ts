/** The exclusive local-date range used to render a multi-day timed span. */
export interface MultiDayDisplayRange {
  start: string;
  end: string;
}

/** Formats a Date as a local calendar date without UTC conversion. */
export function formatLocalDate(date: Date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

/** Parses a canonical local calendar date without applying UTC conversion. */
export function parseLocalDate(value: string): Date | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;

  const year = Number(match[1]);
  const month = Number(match[2]) - 1;
  const day = Number(match[3]);
  const date = new Date(year, month, day);

  return date.getFullYear() === year &&
    date.getMonth() === month &&
    date.getDate() === day
    ? date
    : undefined;
}

/** Whether two dates fall on the same local calendar day. */
export function isSameLocalDate(first: Date, second: Date) {
  return (
    first.getFullYear() === second.getFullYear() &&
    first.getMonth() === second.getMonth() &&
    first.getDate() === second.getDate()
  );
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
