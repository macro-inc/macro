import { match } from 'ts-pattern';
import type { SpendBucket } from '../generated/types';

export type SpendBar = {
  /** The period's start, UTC. */
  start: Date;
  costUsd: number;
};

/**
 * One bar per period of the window, oldest first, with periods that had no
 * spend at zero: the server sends only periods with spend. Periods start in
 * UTC, as the server buckets them; weeks start on Monday.
 */
export function spendBars(
  bucket: SpendBucket,
  from: string,
  until: string,
  buckets: readonly { start: string; costUsd: number }[]
): SpendBar[] {
  const end = new Date(until).getTime();
  let cursor = periodStart(bucket, new Date(from));
  if (Number.isNaN(cursor.getTime()) || Number.isNaN(end)) return [];
  const spent = new Map<number, number>();
  for (const entry of buckets) {
    const key = periodStart(bucket, new Date(entry.start)).getTime();
    spent.set(key, (spent.get(key) ?? 0) + entry.costUsd);
  }
  const bars: SpendBar[] = [];
  // A window is at most a few dozen periods; the cap guards a bad response.
  while (cursor.getTime() < end && bars.length < MAX_BARS) {
    bars.push({ start: cursor, costUsd: spent.get(cursor.getTime()) ?? 0 });
    cursor = nextPeriod(bucket, cursor);
  }
  return bars;
}

const MAX_BARS = 400;

export function periodStart(bucket: SpendBucket, at: Date): Date {
  const y = at.getUTCFullYear();
  const m = at.getUTCMonth();
  const d = at.getUTCDate();
  return match(bucket)
    .with('day', () => new Date(Date.UTC(y, m, d)))
    .with('week', () => {
      // getUTCDay: Sunday is 0; weeks start on Monday.
      const back = (at.getUTCDay() + 6) % 7;
      return new Date(Date.UTC(y, m, d - back));
    })
    .with('month', () => new Date(Date.UTC(y, m, 1)))
    .with('year', () => new Date(Date.UTC(y, 0, 1)))
    .exhaustive();
}

function nextPeriod(bucket: SpendBucket, start: Date): Date {
  const y = start.getUTCFullYear();
  const m = start.getUTCMonth();
  const d = start.getUTCDate();
  return match(bucket)
    .with('day', () => new Date(Date.UTC(y, m, d + 1)))
    .with('week', () => new Date(Date.UTC(y, m, d + 7)))
    .with('month', () => new Date(Date.UTC(y, m + 1, 1)))
    .with('year', () => new Date(Date.UTC(y + 1, 0, 1)))
    .exhaustive();
}

/** The window's total, for the pane's headline. */
export function spendTotal(bars: readonly SpendBar[]): number {
  return bars.reduce((sum, bar) => sum + bar.costUsd, 0);
}

/** Pixels each bar needs for its label to stay readable. */
const BAR_WIDTH_PX = 26;
const MIN_BARS = 6;

/** The latest bars that fit `width`, all of them when they do. */
export function fittingBars(bars: SpendBar[], width: number): SpendBar[] {
  const fit = Math.max(MIN_BARS, Math.floor(width / BAR_WIDTH_PX));
  return bars.length > fit ? bars.slice(-fit) : bars;
}
