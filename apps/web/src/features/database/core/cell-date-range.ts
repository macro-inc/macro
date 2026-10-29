import type { DateRange } from '@core/database-sql/generated/types';
import { fromCellDate, toCellDate } from './cell-date';
import type { DatabaseCellValue } from './database-view';

/**
 * A time-range cell as the grid holds it: its two stored instants as an ISO
 * 8601 interval, `start/end`, the form SQL writes it in too.
 */
export function toCellRange(range: DateRange): string {
  return `${range.start}/${range.end}`;
}

/** The stored instants of a range cell; `undefined` for anything else. */
function fromCellRange(value: DatabaseCellValue): DateRange | undefined {
  if (typeof value !== 'string') return undefined;
  const [start, end, ...rest] = value.split('/');
  if (!start || !end || rest.length) return undefined;
  return { start, end };
}

/**
 * A time range as pickers and timelines edit it. An all-day range spans the
 * local calendar days `start` to `end`, both included, each held at local
 * midnight. A timed range runs from the instant `start` to the instant `end`.
 */
export type CellTimeRange = { allDay: boolean; start: Date; end: Date };

/**
 * Whether a stored instant is a whole day: UTC midnight, the form date cells
 * store a calendar day in. A timed end at exactly UTC midnight reads as a day.
 */
function isStoredDay(instant: string): boolean {
  return /T00:00(:00(\.0+)?)?(Z|\+00:00)$/.test(instant);
}

/**
 * The range two stored instants hold, ending no earlier than it starts. It
 * is all day when both ends are whole days; otherwise both ends are exact
 * instants.
 */
export function timeRangeFromInstants(
  range: DateRange
): CellTimeRange | undefined {
  if (isStoredDay(range.start) && isStoredDay(range.end)) {
    const start = fromCellDate(range.start);
    const end = fromCellDate(range.end);
    if (!start || !end || end < start) return undefined;
    return { allDay: true, start, end };
  }
  const start = new Date(range.start);
  const end = new Date(range.end);
  if (
    !Number.isFinite(start.getTime()) ||
    !Number.isFinite(end.getTime()) ||
    end < start
  )
    return undefined;
  return { allDay: false, start, end };
}

/** The instants storing `range`: whole days as UTC midnight, times as themselves. */
export function timeRangeToInstants(range: CellTimeRange): DateRange {
  return range.allDay
    ? { start: toCellDate(range.start), end: toCellDate(range.end) }
    : { start: range.start.toISOString(), end: range.end.toISOString() };
}

/** The range a cell holds; see `timeRangeFromInstants`. */
export function cellTimeRange(
  value: DatabaseCellValue
): CellTimeRange | undefined {
  const range = fromCellRange(value);
  return range && timeRangeFromInstants(range);
}

/** The cell storing `range`: whole days as UTC midnight, times as instants. */
export function toCellTimeRange(range: CellTimeRange): string {
  return toCellRange(timeRangeToInstants(range));
}
