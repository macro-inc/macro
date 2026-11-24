import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheHost } from '@graphql-cache/index';
import {
  type CacheResponseErrorCode,
  isCacheResponseErrorCode,
} from '@graphql-cache/protocol';
import {
  type CacheErrorCode,
  classifyCacheError,
} from '@graphql-cache/telemetry';
import { type Span, Telemetry } from '@macro-inc/observability';
import { CombinedError } from '@urql/core';
import { type Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { CalendarOccurrenceQueryRange } from '../keys';
import type { CalendarOccurrencesData } from '../occurrences';
import {
  type CalendarRangeRead,
  type FetchCalendarOccurrencePage,
  readCalendarRange,
} from './range';
import {
  CALENDAR_CACHE_HEAD_START_MS,
  CALENDAR_CACHE_READ_DEADLINE_MS,
  withinDeadline,
} from './readiness';
import type { CalendarSyncController } from './sync-controller';

/** Why a viewport the cache should serve was read from REST instead. */
export type CalendarCacheFallback =
  /** A starting cache had not answered within its head start. */
  | 'not-ready'
  /** The native engine cannot serve calendar ranges. */
  | 'unsupported'
  /** The cache path was still running at the deadline and REST answered first. */
  | 'deadline'
  /** As `deadline`, with the head start a read gets while another is overdue. */
  | 'stalled'
  /** A cache request failed: refused during an owner handoff, timed out. */
  | 'cache-error'
  /** The cache path's GraphQL fetch of an uncovered span failed. */
  | 'fetch-error'
  /**
   * The cache could not apply the changes since a REST answer already on
   * screen or a change it was told of, so its week may be older; it answers
   * only if REST fails too.
   */
  | 'behind';

export type CalendarViewportRead =
  | { source: 'cache'; data: CalendarOccurrencesData }
  | {
      source: 'rest';
      data: CalendarOccurrencesData;
      fallback: CalendarCacheFallback;
    };

export type FetchCalendarOccurrencesFromRest = (
  range: CalendarOccurrenceQueryRange,
  signal?: AbortSignal
) => Promise<CalendarOccurrencesData>;

type CacheOutcome = Result<CalendarRangeRead, unknown>;

type CacheAnswer =
  | { answered: true; data: CalendarOccurrencesData }
  | {
      answered: false;
      fallback: CalendarCacheFallback;
      error?: unknown;
      /** What an older cache holds, for when REST cannot answer either. */
      older?: CalendarOccurrencesData;
    };

type Contender =
  | { from: 'cache'; outcome: CacheOutcome }
  | { from: 'rest'; result: Result<CalendarOccurrencesData, unknown> };

type TraceSpan = Pick<Span, 'setAttr'>;

type CatchUpSource = Pick<CalendarSyncController, 'caughtUp' | 'catchUp'>;

// Cache reads of each host still running past their deadline. While one is,
// later viewports give the cache only the startup head start before REST
// races it, instead of each waiting out the full deadline.
const overdueReads = new WeakMap<object, number>();

function cacheStalled(host: object): boolean {
  return (overdueReads.get(host) ?? 0) > 0;
}

async function holdWhileOverdue(
  host: object,
  outcome: PromiseLike<CacheOutcome>
): Promise<void> {
  overdueReads.set(host, (overdueReads.get(host) ?? 0) + 1);
  try {
    await outcome;
  } finally {
    const remaining = (overdueReads.get(host) ?? 1) - 1;
    if (remaining > 0) overdueReads.set(host, remaining);
    else overdueReads.delete(host);
  }
}

/** A bounded name for a cache failure; its message never leaves. */
function cacheFailureKind(
  error: unknown
): CacheResponseErrorCode | CacheErrorCode {
  if (
    error instanceof Error &&
    'errorCode' in error &&
    isCacheResponseErrorCode(error.errorCode)
  )
    return error.errorCode;
  return classifyCacheError(error);
}

function cacheAnswer(outcome: CacheOutcome): CacheAnswer {
  if (outcome.isErr()) {
    // urql reports a failed request, offline or refused by the server, as a
    // combined error; anything else came from the cache.
    const fallback =
      outcome.error instanceof CombinedError ? 'fetch-error' : 'cache-error';
    return { answered: false, fallback, error: outcome.error };
  }
  return match(outcome.value)
    .with(
      { kind: 'range' },
      ({ data }): CacheAnswer => ({
        answered: true,
        data,
      })
    )
    .with(
      { kind: 'behind' },
      ({ older }): CacheAnswer => ({
        answered: false,
        fallback: 'behind',
        ...(older ? { older } : {}),
      })
    )
    .with(
      { kind: 'unsupported' },
      (): CacheAnswer => ({ answered: false, fallback: 'unsupported' })
    )
    .with(
      { kind: 'not-ready' },
      (): CacheAnswer => ({ answered: false, fallback: 'not-ready' })
    )
    .exhaustive(
      (): CacheAnswer => ({ answered: false, fallback: 'cache-error' })
    );
}

function recordCacheAnswer(span: TraceSpan): void {
  span.setAttr('calendar.read.source', 'cache');
}

/** Offline, an older cache still beats no week at all. */
function olderCache(
  span: TraceSpan,
  data: CalendarOccurrencesData
): CalendarViewportRead {
  recordCacheAnswer(span);
  span.setAttr('calendar.read.older_cache', true);
  return { source: 'cache', data };
}

function recordFallback(
  span: TraceSpan,
  fallback: CalendarCacheFallback,
  error?: unknown
): void {
  span.setAttr('calendar.read.source', 'rest');
  span.setAttr('calendar.read.fallback_reason', fallback);
  if (
    fallback !== 'cache-error' &&
    fallback !== 'deadline' &&
    fallback !== 'behind'
  )
    return;
  const cacheError =
    fallback === 'cache-error' ? cacheFailureKind(error) : undefined;
  if (cacheError) span.setAttr('calendar.read.cache_error', cacheError);
  // Startup, old engines and failed fetches are expected; these mean the
  // cache stopped answering, so count them whether or not the trace is kept.
  Telemetry.warn('calendar.occurrences.cache_fallback', {
    'calendar.read.fallback_reason': fallback,
    ...(cacheError ? { 'calendar.read.cache_error': cacheError } : {}),
  });
}

/**
 * Past the deadline, REST races the still-running cache path and the first to
 * answer wins. The cache path keeps running either way, so a slow one still
 * records the week and the cache catches up.
 */
async function raceCacheWithRest(
  cache: PromiseLike<CacheOutcome>,
  range: CalendarOccurrenceQueryRange,
  fetchRest: FetchCalendarOccurrencesFromRest,
  span: TraceSpan,
  deadlineFallback: 'deadline' | 'stalled',
  signal?: AbortSignal
): Promise<CalendarViewportRead> {
  if (signal?.aborted) throw signal.reason;
  const restController = new AbortController();
  const abortRest = () => restController.abort(signal?.reason);
  signal?.addEventListener('abort', abortRest, { once: true });
  const rest = ResultAsync.fromPromise(
    fetchRest(range, restController.signal),
    (error) => error
  );
  try {
    const first = await Promise.race<Contender>([
      (async (): Promise<Contender> => ({
        from: 'cache',
        outcome: await cache,
      }))(),
      (async (): Promise<Contender> => ({
        from: 'rest',
        result: await rest,
      }))(),
    ]);
    if (first.from === 'cache') {
      const answer = cacheAnswer(first.outcome);
      if (answer.answered) {
        restController.abort();
        recordCacheAnswer(span);
        return { source: 'cache', data: answer.data };
      }
      // The cache gave up after all: its own reason explains the REST read.
      recordFallback(span, answer.fallback, answer.error);
      const result = await rest;
      if (result.isOk()) {
        return {
          source: 'rest',
          data: result.value,
          fallback: answer.fallback,
        };
      }
      if (answer.older && !signal?.aborted)
        return olderCache(span, answer.older);
      throw result.error;
    }
    if (first.result.isOk()) {
      recordFallback(span, deadlineFallback);
      return {
        source: 'rest',
        data: first.result.value,
        fallback: deadlineFallback,
      };
    }
    if (signal?.aborted) throw first.result.error;
    // Offline, the cache may still answer a covered week. An overdue cache
    // path may also never settle, so it gets one more deadline, not forever.
    const late = await withinDeadline(cache, CALENDAR_CACHE_READ_DEADLINE_MS);
    if (late !== 'deadline') {
      const answer = cacheAnswer(late);
      if (answer.answered) {
        recordCacheAnswer(span);
        return { source: 'cache', data: answer.data };
      }
      if (answer.older) return olderCache(span, answer.older);
    }
    recordFallback(span, deadlineFallback);
    throw first.result.error;
  } finally {
    signal?.removeEventListener('abort', abortRest);
  }
}

/**
 * Reads a viewport through the cache, or from REST whenever the cache cannot
 * answer: a starting or unsupported engine, a failed cache request (an owner
 * handoff refusing reads, a timed-out read), or a cache path still running at
 * the deadline, such as a read, commit or write acknowledgement waiting on an
 * owner change. A healthy cache answers before the deadline and nothing
 * touches REST.
 */
export async function readCalendarViewport(
  host: Pick<
    CacheHost,
    'calendarRange' | 'calendarCommit' | 'readRecordsByKeys'
  >,
  range: CalendarOccurrenceQueryRange,
  options: {
    fetchRest: FetchCalendarOccurrencesFromRest;
    span: TraceSpan;
    signal?: AbortSignal;
    fetchPage?: FetchCalendarOccurrencePage;
    /** Brings the cache forward after a REST answer or a change notice. */
    sync?: CatchUpSource;
  }
): Promise<CalendarViewportRead> {
  const { fetchRest, span, signal } = options;
  const stalled = cacheStalled(host);
  const deadlineMs = stalled
    ? CALENDAR_CACHE_HEAD_START_MS
    : CALENDAR_CACHE_READ_DEADLINE_MS;
  span.setAttr('calendar.read.deadline_ms', deadlineMs);
  span.setAttr('calendar.read.stalled', stalled);
  const cache = ResultAsync.fromPromise(
    readCalendarRange(host, range, {
      signal,
      span,
      ...(options.fetchPage ? { fetchPage: options.fetchPage } : {}),
      ...(options.sync ? { sync: options.sync } : {}),
    }),
    (error) => error
  );
  const first = await withinDeadline(cache, deadlineMs);
  span.setAttr('calendar.read.deadline_exceeded', first === 'deadline');
  if (first === 'deadline') {
    fireAndForget(holdWhileOverdue(host, cache), 'calendar-cache-read');
    return raceCacheWithRest(
      cache,
      range,
      fetchRest,
      span,
      stalled ? 'stalled' : 'deadline',
      signal
    );
  }
  const answer = cacheAnswer(first);
  if (answer.answered) {
    recordCacheAnswer(span);
    return { source: 'cache', data: answer.data };
  }
  if (signal?.aborted) throw answer.error ?? signal.reason;
  recordFallback(span, answer.fallback, answer.error);
  const rest = await ResultAsync.fromPromise(
    fetchRest(range, signal),
    (error) => error
  );
  if (rest.isOk()) {
    return { source: 'rest', data: rest.value, fallback: answer.fallback };
  }
  if (answer.older && !signal?.aborted) return olderCache(span, answer.older);
  throw rest.error;
}
