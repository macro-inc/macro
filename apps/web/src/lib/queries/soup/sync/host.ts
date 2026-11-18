/**
 * The parts of the sync runner the startup path needs. No runtime imports:
 * `backfill.ts` loads the pass runner only when it streams.
 */
import type {
  SyncFailure,
  SyncHost,
  SyncRunResult,
} from '@graphql-cache/sync-protocol';

/**
 * Statuses that tell this client to wait, not that the stream failed: the
 * user already has a stream open (409), or the server holds its most open
 * streams or asks for fewer requests (503, 429).
 */
const SYNC_BUSY_STATUSES: readonly number[] = [409, 429, 503];

export const isServerBusy = (failure: SyncFailure): boolean =>
  failure.kind === 'http' && SYNC_BUSY_STATUSES.includes(failure.status);

/**
 * The server does not speak this client's sync protocol: the cache engine is
 * older than the oldest the server supports, or newer than the newest.
 */
const SYNC_PROTOCOL_REFUSED = 426;

/**
 * A server that refuses the cache engine's sync protocol leaves this client
 * unable to stream, as a host that cannot stream does: `unsupported`, so the
 * paged backfill takes over instead of retrying.
 */
export const unsupportedWhenRefused = (failure: SyncFailure): SyncFailure =>
  failure.kind === 'http' && failure.status === SYNC_PROTOCOL_REFUSED
    ? { kind: 'unsupported' }
    : failure;

/**
 * Second-pass streams are sized by time and bytes, not a fixed page count:
 * pages range from 5 email threads to 500 documents, so 20 pages took 0.3 s
 * or 7 s. Each stream asks for as many pages as the previous one's rate says
 * fit `targetMs` and `maxBytes` (decoded response bytes), within
 * `minPages`..`maxPages`, and is stopped at `stopAfterMs` whatever it asked
 * for. Every page is still one write at hydration priority, so foreground
 * reads go first during a stream; the pause between streams leaves the
 * network and the cache idle for a moment.
 */
export const SECOND_PASS_STREAM = {
  targetMs: 15_000,
  maxBytes: 32 * 1024 * 1024,
  minPages: 10,
  maxPages: 2_000,
  stopAfterMs: 30_000,
  pauseMs: 2_000,
} as const;

/** Pages the first second-pass stream asks for (no rate known yet). */
export const SECOND_PASS_MAX_PAGES = 20;

/**
 * Pages the next second-pass stream asks for, from the previous stream's
 * pages, duration and bytes; `undefined` (no stream yet) or a stream stopped
 * at `stopAfterMs` (`stopped`) halves the previous size.
 */
export function nextSecondPassPages(
  previous: { pages: number; result?: SyncRunResult } | undefined
): number {
  const { minPages, maxPages, targetMs, maxBytes } = SECOND_PASS_STREAM;
  if (!previous) return SECOND_PASS_MAX_PAGES;
  const clamp = (pages: number) =>
    Math.min(maxPages, Math.max(minPages, Math.floor(pages)));
  const { result } = previous;
  if (!result) return clamp(previous.pages / 2);
  const pages = result.lanes.reduce((sum, lane) => sum + lane.pages, 0);
  if (pages === 0 || result.durationMs <= 0) return clamp(previous.pages);
  const byTime = (pages / result.durationMs) * targetMs;
  const byBytes =
    result.bytes > 0 ? (pages / result.bytes) * maxBytes : Infinity;
  return clamp(Math.min(byTime, byBytes));
}

/** Hosts built before the sync capability lack these methods. */
export function isSyncHost<H extends object>(host: H): host is H & SyncHost {
  return (
    'syncStart' in host &&
    typeof host.syncStart === 'function' &&
    'syncStop' in host &&
    typeof host.syncStop === 'function' &&
    'syncState' in host &&
    typeof host.syncState === 'function'
  );
}
