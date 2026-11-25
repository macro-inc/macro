import type { CalendarRangeCacheResult } from '@graphql-cache/index';
import { OWNER_HANDOFF_BLOCKED_ERROR_CODE } from '@graphql-cache/protocol';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { CombinedError } from '@urql/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarOccurrenceQueryRange } from '../../occurrences';
import type { CalendarOccurrencePage } from '../range';
import {
  CALENDAR_CACHE_HEAD_START_MS,
  CALENDAR_CACHE_READ_DEADLINE_MS,
  markCalendarCacheAnswered,
} from '../readiness';
import type { CalendarCatchUp } from '../sync-controller';
import { readCalendarViewport } from '../viewport';
import { graphqlOccurrence } from './fixtures';

vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: vi.fn(),
}));

const DAY_MS = 86_400_000;
const week = createCalendarOccurrenceQueryRange(
  new Date(2026, 9, 5),
  new Date(2026, 9, 12)
);
const KEY = 'GraphqlCalendarOccurrence:event-1:a';
const restData = { items: [], syncStatus: CalendarSyncStatus.ready };

const covered = (
  overrides: Partial<Extract<CalendarRangeCacheResult, { kind: 'range' }>> = {}
): CalendarRangeCacheResult => ({
  kind: 'range',
  revision: '1' as never,
  occurrenceKeys: [KEY],
  gaps: [],
  freshness: 'fresh',
  uncertainEventKeys: [],
  optimistic: false,
  watermark: null,
  ...overrides,
});

const page = (): CalendarOccurrencePage => ({
  nodes: [],
  hasNextPage: false,
  endCursor: null,
  syncStatus: 'READY',
  watermark: [{ linkId: 'link-1', seq: '9' }],
});

const never = <T>() => new Promise<T>(() => {});

function handoffBlocked() {
  return Object.assign(
    new Error('cache reads unavailable after owner handoff timeout'),
    { errorCode: OWNER_HANDOFF_BLOCKED_ERROR_CODE }
  );
}

function answeredHost() {
  const host = {
    calendarRange: vi.fn(async () => covered()),
    calendarCommit: vi.fn(async () => ({
      kind: 'committed' as const,
      revision: '2' as never,
      changed: [],
    })),
    readRecordsByKeys: vi.fn(async ({ keys }: { keys: string[] }) => ({
      revision: '2' as never,
      records: keys.map((recordKey) => ({
        recordKey,
        record: graphqlOccurrence({
          id: recordKey.slice('GraphqlCalendarOccurrence:'.length),
        }),
      })),
    })),
  };
  markCalendarCacheAnswered(host);
  return host;
}

function fakeSpan() {
  const attributes: Record<string, unknown> = {};
  return {
    attributes,
    setAttr: (name: string, value: unknown) => {
      attributes[name] = value;
    },
  };
}

function read(
  host: ReturnType<typeof answeredHost>,
  options: Partial<Parameters<typeof readCalendarViewport>[2]> = {}
) {
  const span = fakeSpan();
  const fetchRest = options.fetchRest ?? vi.fn(async () => restData);
  const result = readCalendarViewport(host, week, {
    fetchRest,
    span,
    ...options,
  });
  return { result, span, fetchRest };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('readCalendarViewport', () => {
  it('answers a healthy cache without REST', async () => {
    const host = answeredHost();
    const { result, span, fetchRest } = read(host);

    const answer = await result;

    expect(answer.source).toBe('cache');
    expect(answer.data.items).toHaveLength(1);
    expect(fetchRest).not.toHaveBeenCalled();
    expect(span.attributes).toMatchObject({
      'calendar.read.source': 'cache',
      'calendar.read.deadline_exceeded': false,
    });
    // The deadline was cleared: nothing reads REST later either.
    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS * 2);
    expect(fetchRest).not.toHaveBeenCalled();
  });

  it('reads REST at once when the cache refuses reads during an owner handoff', async () => {
    const host = answeredHost();
    host.calendarRange.mockRejectedValue(handoffBlocked());
    const { result, span, fetchRest } = read(host);

    await expect(result).resolves.toEqual({
      source: 'rest',
      data: restData,
      fallback: 'cache-error',
    });
    expect(fetchRest).toHaveBeenCalledWith(week, undefined);
    expect(span.attributes).toMatchObject({
      'calendar.read.source': 'rest',
      'calendar.read.fallback_reason': 'cache-error',
      'calendar.read.cache_error': 'owner-handoff-blocked',
    });
  });

  it('reads REST at the deadline when a gap commit never settles', async () => {
    const host = answeredHost();
    host.calendarRange.mockResolvedValueOnce(
      covered({
        occurrenceKeys: [],
        gaps: [{ kind: 'timed', start: 0, end: DAY_MS }],
      })
    );
    host.calendarCommit.mockImplementation(never);
    const fetchPage = vi.fn(async () => page());
    const { result, fetchRest } = read(host, { fetchPage });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS - 1);
    expect(fetchPage).toHaveBeenCalledOnce();
    expect(fetchRest).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1);
    await expect(result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'deadline',
    });
  });

  it('reads REST at the deadline when a fetched page is never acknowledged by the cache', async () => {
    const host = answeredHost();
    host.calendarRange.mockResolvedValueOnce(
      covered({
        occurrenceKeys: [],
        gaps: [{ kind: 'timed', start: 0, end: DAY_MS }],
      })
    );
    const { result, span } = read(host, { fetchPage: never });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);

    await expect(result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'deadline',
    });
    expect(span.attributes).toMatchObject({
      'calendar.read.deadline_exceeded': true,
      'calendar.read.fallback_reason': 'deadline',
    });
    expect(host.calendarCommit).not.toHaveBeenCalled();
  });

  it('keeps a slow cache answer that beats REST, and cancels REST', async () => {
    const host = answeredHost();
    let answer!: (result: CalendarRangeCacheResult) => void;
    host.calendarRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    let restSignal: AbortSignal | undefined;
    const fetchRest = vi.fn((_range, signal?: AbortSignal) => {
      restSignal = signal;
      return never<typeof restData>();
    });
    const { result, span } = read(host, { fetchRest });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    expect(fetchRest).toHaveBeenCalledOnce();
    answer(covered());

    await expect(result).resolves.toMatchObject({ source: 'cache' });
    expect(restSignal?.aborted).toBe(true);
    expect(span.attributes).toMatchObject({
      'calendar.read.source': 'cache',
      'calendar.read.deadline_exceeded': true,
    });
  });

  it('gives later viewports only the head start while a read is overdue', async () => {
    const host = answeredHost();
    let answer!: (result: CalendarRangeCacheResult) => void;
    host.calendarRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const first = read(host);
    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    await expect(first.result).resolves.toMatchObject({
      fallback: 'deadline',
    });

    // A week the cache still answers comes from the cache.
    const coveredWeek = read(host);
    await expect(coveredWeek.result).resolves.toMatchObject({
      source: 'cache',
    });
    expect(coveredWeek.fetchRest).not.toHaveBeenCalled();

    // One it cannot answer races REST after the head start.
    host.calendarRange.mockImplementationOnce(never);
    const stuck = read(host);
    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_HEAD_START_MS);
    await expect(stuck.result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'stalled',
    });
    expect(stuck.span.attributes).toMatchObject({
      'calendar.read.stalled': true,
      'calendar.read.deadline_ms': CALENDAR_CACHE_HEAD_START_MS,
    });
    answer(covered());
  });

  it('returns to the full deadline once every overdue read settles', async () => {
    const host = answeredHost();
    let answer!: (result: CalendarRangeCacheResult) => void;
    host.calendarRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const first = read(host);
    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    await first.result;

    answer(covered());
    await vi.waitFor(() => {
      const next = read(host);
      expect(next.span.attributes['calendar.read.stalled']).toBe(false);
    });
  });

  it('fails after one more deadline when REST fails and the cache never answers', async () => {
    const host = answeredHost();
    host.calendarRange.mockImplementationOnce(never);
    const fetchRest = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result, span } = read(host, { fetchRest });
    let settled = false;
    const failed = expect(result)
      .rejects.toThrow('offline')
      .finally(() => {
        settled = true;
      });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS * 2 - 1);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(1);

    await failed;
    expect(span.attributes['calendar.read.fallback_reason']).toBe('deadline');
  });

  it('answers from a late cache when REST fails', async () => {
    const host = answeredHost();
    let answer!: (result: CalendarRangeCacheResult) => void;
    host.calendarRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const fetchRest = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result, span } = read(host, { fetchRest });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    expect(fetchRest).toHaveBeenCalledOnce();
    answer(covered());

    await expect(result).resolves.toMatchObject({ source: 'cache' });
    expect(span.attributes['calendar.read.source']).toBe('cache');
  });

  it('aborts the racing REST read when the query is cancelled', async () => {
    const host = answeredHost();
    host.calendarRange.mockImplementationOnce(never);
    const controller = new AbortController();
    let restSignal: AbortSignal | undefined;
    const fetchRest = vi.fn(
      (_range, signal?: AbortSignal) =>
        new Promise<typeof restData>((_resolve, reject) => {
          restSignal = signal;
          signal?.addEventListener('abort', () => reject(signal.reason));
        })
    );
    const { result } = read(host, { fetchRest, signal: controller.signal });
    const rejected = expect(result).rejects.toThrow('cancelled');

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    expect(restSignal?.aborted).toBe(false);
    controller.abort(new Error('cancelled'));

    await rejected;
    expect(restSignal?.aborted).toBe(true);
  });

  it('marks an engine that turns out unsupported after the deadline', async () => {
    const host = answeredHost();
    let answer!: (result: CalendarRangeCacheResult) => void;
    host.calendarRange.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          answer = resolve;
        })
    );
    const fetchRest = vi.fn(async () => {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return restData;
    });
    const { result } = read(host, { fetchRest });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    answer({ kind: 'unsupported' });
    await vi.advanceTimersByTimeAsync(1_000);

    await expect(result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'unsupported',
    });
  });

  it('labels a failed fetch of an uncovered week apart from cache failures', async () => {
    const host = answeredHost();
    host.calendarRange.mockResolvedValueOnce(
      covered({
        occurrenceKeys: [],
        gaps: [{ kind: 'timed', start: 0, end: DAY_MS }],
      })
    );
    const fetchPage = vi.fn(async () => {
      throw new CombinedError({ networkError: new Error('offline') });
    });
    const { result, span } = read(host, { fetchPage });

    await expect(result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'fetch-error',
    });
    expect(span.attributes['calendar.read.cache_error']).toBeUndefined();
  });

  it('does not read REST for a cancelled read', async () => {
    const host = answeredHost();
    const controller = new AbortController();
    host.calendarRange.mockImplementationOnce(async () => {
      controller.abort();
      throw new DOMException('aborted', 'AbortError');
    });
    const { result, fetchRest } = read(host, { signal: controller.signal });

    await expect(result).rejects.toThrow('aborted');
    expect(fetchRest).not.toHaveBeenCalled();
  });

  it('reads REST for an engine without calendar ranges', async () => {
    const host = answeredHost();
    host.calendarRange.mockResolvedValueOnce({ kind: 'unsupported' });
    const { result } = read(host);

    await expect(result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'unsupported',
    });
  });
});

describe('readCalendarViewport after REST showed newer data', () => {
  const sync = (outcome: CalendarCatchUp) => ({
    caughtUp: () => outcome === 'current',
    catchUp: vi.fn(async () => outcome),
  });

  it('answers from the cache once a delta held the read', async () => {
    const host = answeredHost();
    const { result, span, fetchRest } = read(host, { sync: sync('held') });

    await expect(result).resolves.toMatchObject({ source: 'cache' });
    expect(fetchRest).not.toHaveBeenCalled();
    // The range is read again after the delta changed it.
    expect(host.calendarRange).toHaveBeenCalledTimes(2);
    expect(span.attributes).toMatchObject({
      'calendar.read.source': 'cache',
      'calendar.read.catch_up': 'held',
    });
  });

  it('records a read that retried a failed delta', async () => {
    const host = answeredHost();
    const { result, span } = read(host, { sync: sync('retried') });

    await expect(result).resolves.toMatchObject({ source: 'cache' });
    expect(span.attributes['calendar.read.catch_up']).toBe('retried');
  });

  it('reads REST when the cache could not be brought forward', async () => {
    const host = answeredHost();
    const { result, span, fetchRest } = read(host, { sync: sync('behind') });

    await expect(result).resolves.toEqual({
      source: 'rest',
      data: restData,
      fallback: 'behind',
    });
    expect(fetchRest).toHaveBeenCalledOnce();
    expect(span.attributes).toMatchObject({
      'calendar.read.source': 'rest',
      'calendar.read.fallback_reason': 'behind',
      'calendar.read.catch_up': 'behind',
    });
  });

  it('answers from the older cache when REST cannot answer either', async () => {
    const host = answeredHost();
    const fetchRest = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { result, span } = read(host, {
      sync: sync('behind'),
      fetchRest,
    });

    const answer = await result;
    expect(answer.source).toBe('cache');
    expect(answer.data.items).toHaveLength(1);
    expect(span.attributes).toMatchObject({
      'calendar.read.source': 'cache',
      'calendar.read.older_cache': true,
    });
  });

  it('reads REST without fetching the gaps of a week the cache cannot bring forward', async () => {
    const host = answeredHost();
    host.calendarRange.mockResolvedValueOnce(
      covered({
        occurrenceKeys: [],
        gaps: [{ kind: 'timed', start: 0, end: DAY_MS }],
      })
    );
    const fetchPage = vi.fn(async () => page());
    const fetchRest = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { result } = read(host, {
      sync: sync('behind'),
      fetchPage,
      fetchRest,
    });

    await expect(result).rejects.toThrow('Failed to fetch');
    expect(fetchPage).not.toHaveBeenCalled();
    expect(fetchRest).toHaveBeenCalledOnce();
  });

  it('records a read still waiting for its delta when REST answers at the deadline', async () => {
    const host = answeredHost();
    const waiting = {
      caughtUp: () => false,
      catchUp: vi.fn(never<CalendarCatchUp>),
    };
    const { result, span } = read(host, { sync: waiting });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    await expect(result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'deadline',
    });
    expect(span.attributes['calendar.read.catch_up']).toBe('waiting');
  });

  it('answers from the older cache when a late answer is behind and REST failed', async () => {
    const host = answeredHost();
    const late = Promise.withResolvers<CalendarCatchUp>();
    const fetchRest = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    const { result, span } = read(host, {
      sync: { caughtUp: () => false, catchUp: () => late.promise },
      fetchRest,
    });

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);
    late.resolve('behind');
    const answer = await result;
    expect(answer.source).toBe('cache');
    expect(answer.data.items).toHaveLength(1);
    expect(span.attributes).toMatchObject({
      'calendar.read.catch_up': 'behind',
      'calendar.read.older_cache': true,
    });
  });

  it('rereads a range when a delta finished during a read that began behind', async () => {
    const host = answeredHost();
    let caughtUp = false;
    host.calendarRange.mockImplementationOnce(async () => {
      caughtUp = true;
      return covered({ occurrenceKeys: [] });
    });
    const { result, fetchRest } = read(host, {
      sync: {
        caughtUp: () => caughtUp,
        catchUp: vi.fn(async (): Promise<CalendarCatchUp> => 'current'),
      },
    });

    const answer = await result;
    expect(answer.source).toBe('cache');
    expect(answer.data.items).toHaveLength(1);
    expect(host.calendarRange).toHaveBeenCalledTimes(2);
    expect(fetchRest).not.toHaveBeenCalled();
  });

  it('asks nothing of a cache that is current', async () => {
    const host = answeredHost();
    const current = sync('current');
    const { result, span, fetchRest } = read(host, { sync: current });

    await expect(result).resolves.toMatchObject({ source: 'cache' });
    expect(fetchRest).not.toHaveBeenCalled();
    expect(host.calendarRange).toHaveBeenCalledOnce();
    expect(current.catchUp).not.toHaveBeenCalled();
    expect(span.attributes['calendar.read.catch_up']).toBeUndefined();
  });
});
