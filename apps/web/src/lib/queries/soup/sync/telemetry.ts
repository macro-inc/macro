/**
 * Traces of the streamed cache sync.
 *
 * Each stream the app opens is one `graphql_cache.sync.stream` client span.
 * The request carries the span's trace context, so the server's request,
 * `soup.sync_stream` and page spans join it: one trace per stream, from the
 * app's request to the last page the cache wrote. A pass is recorded when it
 * ends as one `graphql_cache.sync.pass` span, from its first stream to its
 * outcome. `cache.sync_session` is the same on every span of one sync run and
 * links a pass to its streams. A run that follows a stop (`sync/resume.ts`)
 * says so on its passes: how many stops came before it and what woke it.
 *
 * Attributes are counts, durations and fixed classes. Lane errors and failure
 * messages never leave this module. A failure to record never reaches the
 * sync: a stream then runs untraced.
 */
import type {
  SyncFailure,
  SyncPass,
  SyncRunOutcome,
} from '@graphql-cache/sync-protocol';
import { type Span, Telemetry } from '@macro-inc/observability';
import { isServerBusy } from './host';
import type { SyncResume } from './resume';

/**
 * How a pass ended: `complete`, stopped by the app (`interrupted`: another
 * tab took over, the user or the cache changed), or the failure it gave up on.
 */
export type SyncPassOutcome = 'complete' | 'interrupted' | SyncFailure['kind'];

export type SyncPassTrace = {
  /** Runs one stream inside its span; `run` sends `traceHeaders` with it. */
  stream(
    run: (traceHeaders: Record<string, string>) => Promise<SyncRunOutcome>
  ): Promise<SyncRunOutcome>;
  /** Records the pass with what its streams did. */
  end(outcome: SyncPassOutcome): void;
};

type PassTotals = {
  streams: number;
  /** Streams the server asked to retry later (409, 429, 503). */
  busyStreams: number;
  failedStreams: number;
  bytes: number;
  pages: number;
  items: number;
  writeMs: number;
  laneFailures: number;
};

/** Outcomes of a pass that are not failures. */
const PASS_ENDED_NORMALLY: readonly SyncPassOutcome[] = [
  'complete',
  'interrupted',
  'unsupported',
];

/**
 * Starts tracing one pass of the sync run `session`; `resumed` when the run
 * follows a stop.
 */
export function traceSyncPass(
  session: string,
  pass: SyncPass,
  resumed?: SyncResume
): SyncPassTrace {
  const startedAt = Date.now();
  const totals: PassTotals = {
    streams: 0,
    busyStreams: 0,
    failedStreams: 0,
    bytes: 0,
    pages: 0,
    items: 0,
    writeMs: 0,
    laneFailures: 0,
  };

  return {
    async stream(run) {
      const index = totals.streams;
      totals.streams += 1;
      const traceHeaders: Record<string, string> = {};
      const span = untraced(() => {
        const span = Telemetry.span('graphql_cache.sync.stream', {
          kind: 'client',
        });
        span.setAttr('cache.sync_session', session);
        span.setAttr('cache.sync_pass', pass);
        span.setAttr('cache.sync_stream', index);
        span.injectTraceHeaders(traceHeaders);
        return span;
      });

      let outcome: SyncRunOutcome | undefined;
      try {
        outcome = await run(traceHeaders);
        return outcome;
      } finally {
        untraced(() => recordStream(span, totals, outcome));
        untraced(() => span?.end());
      }
    },

    end(outcome) {
      untraced(() => {
        const span = Telemetry.span('graphql_cache.sync.pass', {
          startTime: startedAt,
        });
        span.setAttr('cache.sync_session', session);
        span.setAttr('cache.sync_pass', pass);
        span.setAttr('cache.sync_outcome', outcome);
        span.setAttr('cache.sync_resumes', resumed?.count ?? 0);
        if (resumed) span.setAttr('cache.sync_resumed_by', resumed.by);
        span.setAttr('cache.sync_streams', totals.streams);
        span.setAttr('cache.sync_busy_streams', totals.busyStreams);
        span.setAttr('cache.sync_failed_streams', totals.failedStreams);
        span.setAttr('cache.sync_bytes', totals.bytes);
        span.setAttr('cache.sync_pages', totals.pages);
        span.setAttr('cache.sync_items', totals.items);
        span.setAttr('cache.sync_write_ms', totals.writeMs);
        span.setAttr('cache.sync_failed_lanes', totals.laneFailures);
        if (!PASS_ENDED_NORMALLY.includes(outcome)) span.error(outcome);
        span.end();
      });
    },
  };
}

/**
 * Runs `record` and drops whatever it throws: observability must never
 * affect cache sync.
 */
function untraced<T>(record: () => T): T | undefined {
  try {
    return record();
  } catch {
    return undefined;
  }
}

/**
 * `span` is `undefined` when the stream runs untraced, `outcome` when the
 * stream threw before it had one. The pass totals count either way.
 */
function recordStream(
  span: Span | undefined,
  totals: PassTotals,
  outcome: SyncRunOutcome | undefined
): void {
  if (outcome === undefined) {
    totals.failedStreams += 1;
    span?.setAttr('cache.sync_outcome', 'stream');
    span?.error('stream');
    return;
  }

  const result = outcome.ok ? outcome.result : outcome.partial;
  if (result) {
    const pages = result.lanes.reduce((sum, lane) => sum + lane.pages, 0);
    const items = result.lanes.reduce((sum, lane) => sum + lane.items, 0);
    const writeMs = result.lanes.reduce((sum, lane) => sum + lane.writeMs, 0);
    const failedLanes = result.lanes.filter(
      (lane) => lane.error !== undefined
    ).length;
    span?.setAttr('cache.duration_ms', result.durationMs);
    span?.setAttr('cache.sync_bytes', result.bytes);
    span?.setAttr('cache.sync_lanes', result.lanes.length);
    span?.setAttr('cache.sync_pages', pages);
    span?.setAttr('cache.sync_items', items);
    span?.setAttr('cache.sync_write_ms', writeMs);
    span?.setAttr('cache.sync_failed_lanes', failedLanes);
    totals.bytes += result.bytes;
    totals.pages += pages;
    totals.items += items;
    totals.writeMs += writeMs;
    totals.laneFailures += failedLanes;
  }

  if (outcome.ok) {
    span?.setAttr('cache.sync_outcome', outcome.result.reason);
    return;
  }

  const { failure } = outcome;
  span?.setAttr('cache.sync_outcome', failure.kind);
  if (failure.kind === 'http') {
    span?.setAttr('http.response.status_code', failure.status);
  }
  if (isServerBusy(failure)) {
    totals.busyStreams += 1;
    return;
  }
  // The app stopped the stream itself (a time-boxed second-pass stream).
  if (failure.kind === 'aborted') return;
  totals.failedStreams += 1;
  span?.error(failure.kind);
}
