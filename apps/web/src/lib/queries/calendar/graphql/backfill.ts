import { getCalendarSupportedRange } from '@app/features/calendar/utils/calendar-supported-range';
import type { CacheHost } from '@graphql-cache/index';
import type { CalendarOccurrenceQueryRange } from '../keys';
import { createCalendarOccurrenceQueryRange } from '../occurrences';
import {
  calendarGapWindows,
  type FetchCalendarOccurrencePage,
  fetchCalendarWindow,
  hydrateCalendarOccurrencePage,
  toCalendarRangeArgs,
} from './range';

const BACKFILL_MONTHS = 12;
const CHUNK_DELAY_MS = 2_000;
// Backfill pages are exempt from the foreground read deadline. A page that
// never settles must still fail the backfill so its owner retries it.
const PAGE_TIMEOUT_MS = 60_000;

/**
 * Months to cover, nearest first: this month, then alternating forward and
 * back to twelve months each way, clamped to the range the server serves.
 */
export function calendarBackfillMonths(
  now = new Date(),
  months = BACKFILL_MONTHS
): CalendarOccurrenceQueryRange[] {
  const supported = getCalendarSupportedRange(now);
  const offsets = [0];
  for (let offset = 1; offset <= months; offset += 1) {
    offsets.push(offset, -offset);
  }
  return offsets.flatMap((offset) => {
    const start = new Date(now.getFullYear(), now.getMonth() + offset, 1);
    const end = new Date(now.getFullYear(), now.getMonth() + offset + 1, 1);
    const clampedStart = start < supported.start ? supported.start : start;
    const clampedEnd = end > supported.end ? supported.end : end;
    return clampedStart < clampedEnd
      ? [createCalendarOccurrenceQueryRange(clampedStart, clampedEnd)]
      : [];
  });
}

const sleep = (ms: number, signal: AbortSignal) =>
  new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, ms);
    signal.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true }
    );
  });

/**
 * Bounds one page fetch. On timeout it aborts the page's signal and rejects,
 * even when the fetch itself ignores the signal.
 */
function withPageTimeout(
  fetchPage: FetchCalendarOccurrencePage
): FetchCalendarOccurrencePage {
  return async (input, signal) => {
    const timeout = new AbortController();
    const timer = setTimeout(
      () => timeout.abort(new Error('Calendar backfill page timed out')),
      PAGE_TIMEOUT_MS
    );
    const timedOut = new Promise<never>((_, reject) => {
      timeout.signal.addEventListener(
        'abort',
        () => reject(timeout.signal.reason),
        { once: true }
      );
    });
    try {
      return await Promise.race([
        fetchPage(
          input,
          signal ? AbortSignal.any([signal, timeout.signal]) : timeout.signal
        ),
        timedOut,
      ]);
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Widens calendar coverage month by month in the background. Coverage is the
 * checkpoint: a month with no gaps costs one local read, so a restarted lane
 * resumes where the last one stopped.
 */
export async function runCalendarBackfill(
  host: Pick<CacheHost, 'calendarRange' | 'calendarCommit'>,
  options: {
    signal: AbortSignal;
    now?: Date;
    fetchPage?: FetchCalendarOccurrencePage;
    delayMs?: number;
  }
): Promise<void> {
  const { signal } = options;
  const fetchPage = withPageTimeout(
    options.fetchPage ?? hydrateCalendarOccurrencePage
  );
  for (const range of calendarBackfillMonths(options.now)) {
    if (signal.aborted) return;
    const result = await host.calendarRange(toCalendarRangeArgs(range));
    if (result.kind === 'unsupported') return;
    if (result.gaps.length === 0) continue;
    for (const window of calendarGapWindows(result.gaps)) {
      if (signal.aborted) return;
      await fetchCalendarWindow(host, window, fetchPage, signal);
    }
    await sleep(options.delayMs ?? CHUNK_DELAY_MS, signal);
  }
}
