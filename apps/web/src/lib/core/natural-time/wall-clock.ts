import { format, parse } from 'date-fns';

const WALL_CLOCK_FORMAT = "yyyy-MM-dd'T'HH:mm:ss";

/** `date` as the browser's local wall-clock time, the `now` natural_time reads at. */
export function localWallClock(date: Date): string {
  return format(date, WALL_CLOCK_FORMAT);
}

/**
 * The instant a local wall-clock time names in the browser's time zone, or
 * `undefined` when daylight saving skips it. A repeated fall-back hour takes
 * the earlier instant.
 */
export function instantAtWallClock(local: string): Date | undefined {
  const date = parse(local, WALL_CLOCK_FORMAT, new Date());
  if (!Number.isFinite(date.getTime())) return;
  // A skipped wall time moves forward, so it no longer reads the same.
  if (localWallClock(date) !== local) return;
  return date;
}
