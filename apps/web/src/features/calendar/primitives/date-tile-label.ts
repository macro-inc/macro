import { isSameDay, isSameMonth, isSameYear } from 'date-fns';

export interface DateTileRange {
  start: Date;
  /** Exclusive end, matching calendar occurrences. */
  end?: Date;
}

/** A tile shows an in-month day range, or the start day across months. */
export function dateTileLabel(range: DateTileRange) {
  const start = range.start;
  const finalInstant =
    range.end && range.end > start ? new Date(range.end.getTime() - 1) : start;
  const month = new Intl.DateTimeFormat(undefined, { month: 'short' })
    .format(start)
    .toLocaleUpperCase();
  const day = new Intl.DateTimeFormat(undefined, { day: 'numeric' });
  const showsRange =
    !isSameDay(start, finalInstant) &&
    isSameMonth(start, finalInstant) &&
    isSameYear(start, finalInstant);
  return {
    month,
    day: showsRange
      ? `${day.format(start)}–${day.format(finalInstant)}`
      : day.format(start),
  };
}
