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
import { type Result, ResultAsync } from 'neverthrow';
import { match } from 'ts-pattern';
import type { CalendarOccurrenceQueryRange } from '../keys';
import type { CalendarOccurrencesData } from '../occurrences';
import {
  type CalendarRangeRead,
  type FetchCalendarOccurrencePage,
  readCalendarRange,
} from './range';
import { CALENDAR_CACHE_READ_DEADLINE_MS } from './readiness';

/** Why a viewport the cache should serve was read from REST instead. */
export type CalendarCacheFallback =
  /** A starting cache had not answered within its head start. */
  | 'not-ready'
  /** The native engine cannot serve calendar ranges. */
  | 'unsupported'
  /** An earlier read of this host is still past its deadline. */
  | 'stalled'
  /** The cache path was still running at the deadline and REST answered first. */
  | 'deadline'
  /** The cache path failed: a refused or timed-out cache request, or its fetch. */
  | 'cache-error';

export type CalendarViewportRead =
  | { source: 'cache'; data: CalendarOccurrencesData }
  | {
      source: 'rest';
      data: CalendarOccurrencesData;
      fallback: CalendarCacheFallback;
    };

type CacheOutcome = Result<CalendarRangeRead, unknown>;

type CacheAnswer =
  | { answered: true; data: CalendarOccurrencesData }
  | { answered: false; fallback: CalendarCacheFallback; error?: unknown };

type Contender =
  | { from: 'cache'; outcome: CacheOutcome }
  | { from: 'rest'; result: Result<CalendarOccurrencesData, unknown> };

export type FetchCalendarOccurrencesFromRest = (
  range: CalendarOccurrenceQueryRange,
  signal?: AbortSignal
) => Promise<CalendarOccurrencesData>;

// Cache reads of each host still running past their deadline. While one is,
// later viewports read from REST rather than queue behind it.
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
  if (outcome.isErr())
    return { answered: false, fallback: 'cache-error', error: outcome.error };
  return match(outcome.value)
    .with(
      { kind: 'range' },
      ({ data }): CacheAnswer => ({
        answered: true,
        data,
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

async function deadline(ms: number, cancel: AbortSignal): Promise<'deadline'> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve('deadline'), ms);
    cancel.addEventListener('abort', () => clearTimeout(timer), {
      once: true,
    });
  });
}

function recordFallback(
  span: Pick<Span, 'setAttr'>,
  fallback: CalendarCacheFallback,
  error?: unknown
): void {
  span.setAttr('calendar.read.source', 'rest');
  span.setAttr('calendar.read.fallback_reason', fallback);
  const cacheError = error === undefined ? undefined : cacheFailureKind(error);
  if (cacheError) span.setAttr('calendar.read.cache_error', cacheError);
  // Startup and old engines are expected; these mean the cache stopped
  // answering, so count them whether or not this trace is sampled.
  if (fallback === 'deadline' || fallback === 'cache-error') {
    Telemetry.warn('calendar.occurrences.cache_fallback', {
      'calendar.read.fallback_reason': fallback,
      ...(cacheError ? { 'calendar.read.cache_error': cacheError } : {}),
    });
  }
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
  span: Pick<Span, 'setAttr'>,
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
        span.setAttr('calendar.read.source', 'cache');
        return { source: 'cache', data: answer.data };
      }
      recordFallback(span, 'deadline', answer.error);
      const result = await rest;
      if (result.isErr()) throw result.error;
      return { source: 'rest', data: result.value, fallback: 'deadline' };
    }
    recordFallback(span, 'deadline');
    // An overdue cache path may never settle, so a failed REST read fails the
    // viewport rather than waiting on it.
    if (first.result.isErr()) throw first.result.error;
    return { source: 'rest', data: first.result.value, fallback: 'deadline' };
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
    span: Pick<Span, 'setAttr'>;
    signal?: AbortSignal;
    fetchPage?: FetchCalendarOccurrencePage;
    deadlineMs?: number;
  }
): Promise<CalendarViewportRead> {
  const { fetchRest, span, signal } = options;
  const deadlineMs = options.deadlineMs ?? CALENDAR_CACHE_READ_DEADLINE_MS;
  span.setAttr('calendar.read.deadline_ms', deadlineMs);
  if (cacheStalled(host)) {
    recordFallback(span, 'stalled');
    return {
      source: 'rest',
      data: await fetchRest(range, signal),
      fallback: 'stalled',
    };
  }
  const cache = ResultAsync.fromPromise(
    readCalendarRange(host, range, {
      signal,
      ...(options.fetchPage ? { fetchPage: options.fetchPage } : {}),
    }),
    (error) => error
  );
  const settled = new AbortController();
  const first = await Promise.race([
    cache,
    deadline(deadlineMs, settled.signal),
  ]);
  settled.abort();
  span.setAttr('calendar.read.deadline_exceeded', first === 'deadline');
  if (first === 'deadline') {
    fireAndForget(holdWhileOverdue(host, cache), 'calendar-cache-read');
    return raceCacheWithRest(cache, range, fetchRest, span, signal);
  }
  const answer = cacheAnswer(first);
  if (answer.answered) {
    span.setAttr('calendar.read.source', 'cache');
    return { source: 'cache', data: answer.data };
  }
  if (signal?.aborted) throw answer.error ?? signal.reason;
  recordFallback(span, answer.fallback, answer.error);
  return {
    source: 'rest',
    data: await fetchRest(range, signal),
    fallback: answer.fallback,
  };
}
