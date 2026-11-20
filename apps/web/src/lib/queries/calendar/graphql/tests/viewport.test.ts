import type { CalendarRangeCacheResult } from '@graphql-cache/index';
import { OWNER_HANDOFF_BLOCKED_ERROR_CODE } from '@graphql-cache/protocol';
import { CalendarSyncStatus } from '@service-storage/generated/schemas/calendarSyncStatus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createCalendarOccurrenceQueryRange } from '../../occurrences';
import type { CalendarOccurrencePage } from '../range';
import {
  CALENDAR_CACHE_READ_DEADLINE_MS,
  markCalendarCacheAnswered,
} from '../readiness';
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

  it('sends later viewports straight to REST while a read is overdue, then asks the cache again', async () => {
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

    const second = read(host);
    await expect(second.result).resolves.toMatchObject({
      source: 'rest',
      fallback: 'stalled',
    });
    expect(host.calendarRange).toHaveBeenCalledOnce();

    answer(covered());
    await vi.waitFor(async () => {
      const third = read(host);
      await expect(third.result).resolves.toMatchObject({ source: 'cache' });
    });
  });

  it('fails without waiting on an overdue cache when REST fails too', async () => {
    const host = answeredHost();
    host.calendarRange.mockImplementationOnce(never);
    const fetchRest = vi.fn(async () => {
      throw new Error('offline');
    });
    const { result } = read(host, { fetchRest });
    const failed = expect(result).rejects.toThrow('offline');

    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS);

    await failed;
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
