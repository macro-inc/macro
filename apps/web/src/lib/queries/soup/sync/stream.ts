/**
 * The streamed cache sync's run loop: each pass as streams retried with
 * backoff, failed lanes retried and then left for the next pass, and the
 * whole sync run again once the device is back online or in the foreground.
 * `backfill.ts` chooses between it and the paged backfill (`runCacheSync`).
 */
import {
  enableGraphqlCalendar,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import type { CacheHost } from '@graphql-cache/host/types';
import type {
  SyncFailure,
  SyncHost,
  SyncPass,
  SyncRunResult,
} from '@graphql-cache/sync-protocol';
import * as Effect from 'effect/Effect';
import * as Exit from 'effect/Exit';
import * as Option from 'effect/Option';
import * as Schedule from 'effect/Schedule';
import {
  isServerBusy,
  nextSecondPassPages,
  SECOND_PASS_STREAM,
  unsupportedWhenRefused,
} from './host';
import { type SyncResume, syncResumePauseMs, waitToResumeSync } from './resume';
import type { SyncPassOptions } from './run';
import {
  type SyncPassOutcome,
  type SyncPassTrace,
  traceSyncPass,
} from './telemetry';

/**
 * Retries of a failing stream before the sync stops; it then waits to run
 * again (`sync/resume.ts`).
 */
const SYNC_RETRY_COUNT = 5;
const SYNC_RETRY_SCHEDULE = Schedule.exponential('2 seconds');
/** How long to wait before asking a busy server again (its `Retry-After`). */
const SYNC_BUSY_PAUSE_MS = 30_000;
/**
 * A lane that fails this many times in one pass is left out of that pass's
 * later streams; it resumes from its saved state on the next pass.
 */
const SYNC_LANE_FAILURES = 3;
/** Pause before re-running a failed lane, doubled per failure. */
const SYNC_LANE_RETRY_PAUSE_MS = 2_000;

/** Failures per lane over one pass's streams. */
type LaneFailures = Map<string, number>;

/**
 * Counts the lanes `result` reports failed. Returns the pause before the
 * stream that retries them, or `undefined` when none may be retried.
 */
function recordFailedLanes(
  failures: LaneFailures,
  result: SyncRunResult
): number | undefined {
  let retry: number | undefined;
  for (const lane of result.lanes) {
    if (lane.error === undefined) continue;
    const count = (failures.get(lane.id) ?? 0) + 1;
    failures.set(lane.id, count);
    if (count < SYNC_LANE_FAILURES) {
      retry = Math.max(retry ?? 0, SYNC_LANE_RETRY_PAUSE_MS * 2 ** (count - 1));
    } else {
      console.warn('[graphql-soup-sync] lane failed; it resumes next pass', {
        lane: lane.id,
        failures: count,
      });
    }
  }
  return retry;
}

/** Plan options leaving out lanes that reached `SYNC_LANE_FAILURES`. */
function skipFailedLanes(failures: LaneFailures): {
  skipLanes?: ReadonlySet<string>;
} {
  const skip = new Set(
    [...failures]
      .filter(([, count]) => count >= SYNC_LANE_FAILURES)
      .map(([id]) => id)
  );
  return skip.size === 0 ? {} : { skipLanes: skip };
}

/** A cache host that can stream the sync. */
export type StreamedSyncHost = CacheHost & SyncHost;

/**
 * One stream of `pass`, retried with backoff (except `unsupported`, which a
 * server's refusal of the sync protocol counts as). A busy
 * server is asked again every `SYNC_BUSY_PAUSE_MS` for as long as it stays
 * busy, without spending retries. Every attempt sends the cache's saved lane
 * state, from which the server plans it again, so it resumes rather than
 * restarts, and is one span of `trace`. Interrupting it stops the host's run. With `stopAfterMs`, an
 * attempt still running then is stopped (pages written so far are kept) and
 * the stream resolves to `None` instead of a result.
 */
const runSyncStream = (
  host: StreamedSyncHost,
  pass: SyncPass,
  options: SyncPassOptions,
  trace: SyncPassTrace,
  stopAfterMs?: number
) =>
  Effect.tryPromise({
    try: () =>
      trace.stream(async (traceHeaders) => {
        // Loaded on use, off the startup path.
        const { runSyncPass } = await import('./run');
        return runSyncPass(host, pass, options, traceHeaders);
      }),
    catch: (error): SyncFailure => ({
      kind: 'stream',
      message: error instanceof Error ? error.message : String(error),
    }),
  }).pipe(
    Effect.flatMap(
      (outcome): Effect.Effect<Option.Option<SyncRunResult>, SyncFailure> =>
        outcome.ok
          ? Effect.succeed(Option.some(outcome.result))
          : Effect.fail(unsupportedWhenRefused(outcome.failure))
    ),
    Effect.onInterrupt(() =>
      Effect.tryPromise(() => host.syncStop()).pipe(Effect.ignore)
    ),
    // Per attempt, so a failing stream still exhausts its retries.
    (attempt) =>
      stopAfterMs === undefined
        ? attempt
        : attempt.pipe(
            Effect.timeoutOption(stopAfterMs),
            Effect.map(Option.flatten)
          ),
    Effect.retry({
      schedule: Schedule.spaced(SYNC_BUSY_PAUSE_MS),
      while: isServerBusy,
    }),
    Effect.retry({
      times: SYNC_RETRY_COUNT,
      schedule: SYNC_RETRY_SCHEDULE,
      while: (failure: SyncFailure) => failure.kind !== 'unsupported',
    })
  );

function syncPassOutcome(
  exit: Exit.Exit<unknown, SyncFailure>
): SyncPassOutcome {
  if (Exit.isSuccess(exit)) return 'complete';
  const failure = Exit.findErrorOption(exit);
  return Option.isSome(failure) ? failure.value.kind : 'interrupted';
}

/** Runs one pass of the sync run `session` and records how it ended. */
const traceSyncPassRun = (
  session: string,
  pass: SyncPass,
  resumed: SyncResume | undefined,
  run: (trace: SyncPassTrace) => Effect.Effect<void, SyncFailure>
) =>
  Effect.suspend(() => {
    const trace = traceSyncPass(session, pass, resumed);
    return run(trace).pipe(
      Effect.onExit((exit) =>
        Effect.sync(() => trace.end(syncPassOutcome(exit)))
      )
    );
  });

/**
 * The first pass, resumed for as long as the server ends its stream early or
 * a failed lane may be retried.
 */
const runFirstPass = Effect.fn('runFirstPass')(function* (
  host: StreamedSyncHost,
  calendar: boolean,
  trace: SyncPassTrace
) {
  const startedAt = new Date().toISOString();
  const failures: LaneFailures = new Map();
  while (true) {
    const result = yield* runSyncStream(
      host,
      'first',
      { calendar, completedSince: startedAt, ...skipFailedLanes(failures) },
      trace
    );
    const retry = Option.isSome(result)
      ? recordFailedLanes(failures, result.value)
      : undefined;
    const endedEarly =
      Option.isSome(result) && result.value.reason !== 'complete';
    if (!endedEarly && retry === undefined) return;
    yield* Effect.sleep(retry ?? 0);
  }
});

/**
 * The second pass, as streams sized by time and bytes (`SECOND_PASS_STREAM`)
 * with a short pause between them, until a stream completes.
 */
const runSecondPass = Effect.fn('runSecondPass')(function* (
  host: StreamedSyncHost,
  calendar: boolean,
  trace: SyncPassTrace
) {
  const startedAt = new Date().toISOString();
  const failures: LaneFailures = new Map();
  let previous: { pages: number; result?: SyncRunResult } | undefined;
  while (true) {
    const pages = nextSecondPassPages(previous);
    const result = yield* runSyncStream(
      host,
      'second',
      {
        calendar,
        completedSince: startedAt,
        maxPages: pages,
        ...skipFailedLanes(failures),
      },
      trace,
      SECOND_PASS_STREAM.stopAfterMs
    );
    const retry = Option.isSome(result)
      ? recordFailedLanes(failures, result.value)
      : undefined;
    if (
      Option.isSome(result) &&
      result.value.reason === 'complete' &&
      retry === undefined
    ) {
      return;
    }
    previous = { pages, result: Option.getOrUndefined(result) };
    yield* Effect.sleep(Math.max(SECOND_PASS_STREAM.pauseMs, retry ?? 0));
  }
});

/**
 * The streamed cache sync: the first pass, then the second. A lane that fails
 * (the server's `laneError`) does not stop the others: each pass re-runs it,
 * from its saved state, until it has failed `SYNC_LANE_FAILURES` times. Each
 * pass and each of its streams is traced (`sync/telemetry.ts`). It fails with
 * the failure a stream gave up on; `resumed` says this run follows such a stop.
 */
export const runStreamedSync = Effect.fn('runStreamedSync')(function* (
  host: StreamedSyncHost,
  resumed?: SyncResume
) {
  const calendar = isFeatureEnabled(enableGraphqlCalendar);
  const session = crypto.randomUUID();
  yield* traceSyncPassRun(session, 'first', resumed, (trace) =>
    runFirstPass(host, calendar, trace)
  );
  yield* traceSyncPassRun(session, 'second', resumed, (trace) =>
    runSecondPass(host, calendar, trace)
  );
});

/**
 * The streamed sync, run again each time it stops: after a stream used up its
 * retries it waits for the device to come back online, the app to return to
 * the foreground, or a pause (`sync/resume.ts`), then resumes from the state
 * saved in the cache. Fails only with `unsupported`.
 */
export const runStreamedSyncUntilDone = (host: StreamedSyncHost) =>
  Effect.suspend(() => {
    let resumed: SyncResume | undefined;
    const waitToResume = (failure: SyncFailure) =>
      Effect.suspend(() => {
        const count = (resumed?.count ?? 0) + 1;
        console.warn('[graphql-soup-sync] stopped after retries; waiting', {
          failure: failure.kind,
          stops: count,
        });
        return Effect.promise((signal) =>
          waitToResumeSync(syncResumePauseMs(count), signal)
        ).pipe(
          Effect.map((by) => {
            resumed = { count, by };
          })
        );
      });
    return Effect.suspend(() => runStreamedSync(host, resumed)).pipe(
      Effect.tapError((failure) =>
        failure.kind === 'unsupported' ? Effect.void : waitToResume(failure)
      ),
      Effect.retry({
        while: (failure: SyncFailure) => failure.kind !== 'unsupported',
      })
    );
  });
