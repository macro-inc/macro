import type { CacheHost, CalendarRangeCacheResult } from '@graphql-cache/index';
import { OWNER_HANDOFF_BLOCKED_ERROR_CODE } from '@graphql-cache/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapCalendarOccurrence } from '../graphql/map';
import {
  CALENDAR_CACHE_READ_DEADLINE_MS,
  markCalendarCacheAnswered,
} from '../graphql/readiness';
import { graphqlOccurrence } from '../graphql/tests/fixtures';
import { useCalendarOccurrencesQuery } from '../occurrences';

const mocks = vi.hoisted(() => ({
  listOccurrences: vi.fn(),
  graphqlQuery: vi.fn(),
}));

let cacheHost: CacheHost | undefined;
let client: QueryClient;
let dispose: (() => void) | undefined;

vi.mock('../graphql/flag', () => ({
  useGraphqlCalendarHost: () => () => cacheHost,
  markCalendarCacheUnsupported: vi.fn(),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { listCalendarOccurrences: mocks.listOccurrences },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupClient: () => ({ query: mocks.graphqlQuery }),
}));
vi.mock('../../client', () => ({
  get queryClient() {
    return client;
  },
}));

const week = {
  start: '2026-10-05T00:00:00.000Z',
  end: '2026-10-12T00:00:00.000Z',
  startDate: '2026-10-05',
  endDate: '2026-10-12',
};
const restData = {
  items: [mapCalendarOccurrence(graphqlOccurrence({ overrideTitle: 'REST' }))],
  syncStatus: 'ready' as const,
};
const restPage = () => ok({ ...restData, hasMore: false, nextCursor: null });

function handoffBlocked() {
  return Object.assign(
    new Error('cache reads unavailable after owner handoff timeout'),
    { errorCode: OWNER_HANDOFF_BLOCKED_ERROR_CODE }
  );
}

/** A host that answered a calendar read earlier in this tab. */
function answeredHost(
  calendarRange: () => Promise<CalendarRangeCacheResult>
): CacheHost {
  const host = {
    calendarRange: vi.fn(calendarRange),
    calendarCommit: vi.fn(),
    onCacheChanged: () => () => {},
    readRecordsByKeys: vi.fn(async () => ({ revision: '1', records: [] })),
  } as unknown as CacheHost;
  markCalendarCacheAnswered(host);
  return host;
}

function renderWeek() {
  let query!: ReturnType<typeof useCalendarOccurrencesQuery>;
  const Harness = () => {
    query = useCalendarOccurrencesQuery(() => ({
      userId: 'user-1',
      range: week,
    }));
    return null;
  };
  dispose = render(
    () => (
      <QueryClientProvider client={client}>
        <Harness />
      </QueryClientProvider>
    ),
    document.body
  );
  return query;
}

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  dispose?.();
  dispose = undefined;
  client.clear();
  cacheHost = undefined;
  vi.useRealTimers();
});

describe('calendar week when the local cache cannot answer', () => {
  it('loads the week from REST once an answering cache stops answering', async () => {
    vi.useFakeTimers();
    cacheHost = answeredHost(() => new Promise(() => {}));
    mocks.listOccurrences.mockResolvedValue(restPage());

    const query = renderWeek();
    await vi.advanceTimersByTimeAsync(CALENDAR_CACHE_READ_DEADLINE_MS - 1);
    expect(mocks.listOccurrences).not.toHaveBeenCalled();
    expect(query.isPending).toBe(true);

    await vi.advanceTimersByTimeAsync(1);
    await vi.waitFor(() => {
      expect(query.isSuccess).toBe(true);
      expect(query.data).toEqual(restData);
    });
    expect(mocks.listOccurrences).toHaveBeenCalledOnce();
  });

  it('loads the week from REST while the cache refuses reads during an owner handoff', async () => {
    cacheHost = answeredHost(() => Promise.reject(handoffBlocked()));
    mocks.listOccurrences.mockResolvedValue(restPage());

    const query = renderWeek();

    await vi.waitFor(() => {
      expect(query.isSuccess).toBe(true);
      expect(query.data).toEqual(restData);
    });
  });

  it('loads the week on Retry once the server answers', async () => {
    cacheHost = answeredHost(() => Promise.reject(handoffBlocked()));
    mocks.listOccurrences.mockResolvedValueOnce(
      err([{ code: 'HTTP_ERROR' as const, message: 'offline' }])
    );

    const query = renderWeek();
    await vi.waitFor(() => expect(query.isError).toBe(true));

    mocks.listOccurrences.mockResolvedValue(restPage());
    await query.refetch();

    await vi.waitFor(() => {
      expect(query.isSuccess).toBe(true);
      expect(query.data).toEqual(restData);
    });
  });
});
