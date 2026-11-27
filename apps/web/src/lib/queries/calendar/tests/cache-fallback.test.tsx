import type {
  CacheHost,
  CalendarCommitArgs,
  CalendarRangeCacheResult,
} from '@graphql-cache/index';
import { OWNER_HANDOFF_BLOCKED_ERROR_CODE } from '@graphql-cache/protocol';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mapCalendarOccurrence } from '../graphql/map';
import {
  CALENDAR_CACHE_READ_DEADLINE_MS,
  markCalendarCacheAnswered,
} from '../graphql/readiness';
import {
  type CalendarChangesPage,
  CalendarSyncController,
  DELTA_RETRY_BASE_MS,
  MAX_DELTA_RETRIES,
  setActiveCalendarSyncController,
} from '../graphql/sync-controller';
import { fakeCalendarCache } from '../graphql/tests/fake-calendar-cache';
import { graphqlEvent, graphqlOccurrence } from '../graphql/tests/fixtures';
import {
  invalidateCalendarOccurrences,
  useCalendarOccurrencesQuery,
} from '../occurrences';

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
const nextWeek = {
  start: '2026-10-12T00:00:00.000Z',
  end: '2026-10-19T00:00:00.000Z',
  startDate: '2026-10-12',
  endDate: '2026-10-19',
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
  setActiveCalendarSyncController(undefined);
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

const existing = graphqlOccurrence();
const created = graphqlOccurrence({
  id: 'event-2:2026-10-07T09:00:00+00:00',
  eventId: 'event-2',
  occurrenceKey: '2026-10-07T09:00:00+00:00',
  time: {
    __typename: 'GraphqlTimedEventTime',
    startsAt: '2026-10-07T09:00:00+00:00',
    endsAt: '2026-10-07T09:30:00+00:00',
    timeZone: null,
  },
  event: graphqlEvent({ id: 'event-2', title: '[dev-verify] created' }),
});
const occurrenceKey = (occurrence: typeof existing) =>
  `GraphqlCalendarOccurrence:${occurrence.id}`;
const eventIds = (
  data: { items: Array<{ event: { id: string } }> } | undefined
) => data?.items.map((item) => item.event.id);

/**
 * A cache that covered the week before `created` existed and answers or
 * refuses reads as `handoff` says, with a delta that can bring it forward.
 */
function staleCoveredCache() {
  const state = {
    handoff: true,
    keys: [occurrenceKey(existing)],
    deltaFails: true,
  };
  const records = new Map(
    [existing, created].map((occurrence) => [
      occurrenceKey(occurrence),
      occurrence,
    ])
  );
  const range = async (args: { endMs: number }) => {
    if (state.handoff) throw handoffBlocked();
    return {
      kind: 'range' as const,
      revision: '1' as never,
      occurrenceKeys: args.endMs === 0 ? [] : [...state.keys],
      gaps: [],
      freshness: 'fresh' as const,
      uncertainEventKeys: [],
      optimistic: false,
      watermark: [{ linkId: 'link-1', seq: '437' }],
    };
  };
  const changeListeners = new Set<(revision: string) => void>();
  const host = {
    calendarRange: vi.fn(range),
    calendarCommit: vi.fn(async (commit: CalendarCommitArgs) => {
      for (const event of commit.replacedEvents ?? []) {
        state.keys = [...new Set([...state.keys, ...event.occurrenceKeys])];
      }
      return {
        kind: 'committed' as const,
        revision: '2' as never,
        changed: [],
      };
    }),
    onCacheChanged: (listener: (revision: string) => void) => {
      changeListeners.add(listener);
      return () => changeListeners.delete(listener);
    },
    readRecordsByKeys: vi.fn(async ({ keys }: { keys: string[] }) => ({
      revision: '2' as never,
      records: keys.flatMap((recordKey) => {
        const record = records.get(recordKey);
        return record ? [{ recordKey, record }] : [];
      }),
    })),
  } as unknown as CacheHost;
  markCalendarCacheAnswered(host);
  const fetchChanges = vi.fn(async (): Promise<CalendarChangesPage> => {
    if (state.deltaFails) throw handoffBlocked();
    return {
      events: [{ event: created.event, occurrences: [created] }],
      deletedEventIds: [],
      calendars: [],
      deletedCalendarIds: [],
      newWatermark: [{ linkId: 'link-1', seq: '439' }],
      hasMore: false,
      resetRequired: false,
    };
  });
  const controller = new CalendarSyncController(host, {
    fetchChanges,
    refetchCalendars: async () => undefined,
  });
  setActiveCalendarSyncController(controller);
  const cacheChanged = () => {
    for (const listener of changeListeners) listener('3');
  };
  return { host, state, fetchChanges, controller, cacheChanged };
}

describe('calendar week after REST showed what the cache missed', () => {
  it('keeps a new event REST showed when the cache answers with its older week', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = staleCoveredCache();
    cacheHost = cache.host;
    mocks.listOccurrences.mockResolvedValue(
      ok({
        items: [existing, created].map(mapCalendarOccurrence),
        syncStatus: 'ready' as const,
        hasMore: false,
        nextCursor: null,
      })
    );

    // The owner handoff refuses reads, so REST shows the new event, and the
    // delta that would have brought the cache forward fails.
    const query = renderWeek();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'event-2'])
    );
    await expect(cache.controller.runDelta()).rejects.toThrow();

    // The cache answers again, still holding the week from before the event.
    cache.state.handoff = false;
    await query.refetch();
    expect(eventIds(query.data)).toEqual(['event-1', 'event-2']);
    expect(mocks.listOccurrences).toHaveBeenCalledTimes(2);

    // The retry brings the cache forward; it answers from then on.
    cache.state.deltaFails = false;
    await vi.advanceTimersByTimeAsync(DELTA_RETRY_BASE_MS);
    await query.refetch();
    expect(eventIds(query.data)).toEqual(['event-1', 'event-2']);
    expect(mocks.listOccurrences).toHaveBeenCalledTimes(2);
    expect(cache.state.keys).toContain(occurrenceKey(created));
    cache.controller.dispose();
    warn.mockRestore();
  });

  it('rereads nothing from REST on cache changes while a failed delta backs off', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = staleCoveredCache();
    cacheHost = cache.host;
    mocks.listOccurrences.mockResolvedValue(
      ok({
        items: [existing, created].map(mapCalendarOccurrence),
        syncStatus: 'ready' as const,
        hasMore: false,
        nextCursor: null,
      })
    );
    const query = renderWeek();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'event-2'])
    );
    await expect(cache.controller.runDelta()).rejects.toThrow();
    cache.state.handoff = false;

    for (let change = 0; change < 5; change += 1) {
      cache.cacheChanged();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(mocks.listOccurrences).toHaveBeenCalledOnce();
    expect(eventIds(query.data)).toEqual(['event-1', 'event-2']);

    // Once the retry brings the cache forward, cache changes read it again.
    cache.state.deltaFails = false;
    await vi.advanceTimersByTimeAsync(DELTA_RETRY_BASE_MS);
    cache.cacheChanged();
    await vi.advanceTimersByTimeAsync(300);
    await vi.waitFor(() =>
      expect(cache.host.readRecordsByKeys).toHaveBeenCalled()
    );
    expect(eventIds(query.data)).toEqual(['event-1', 'event-2']);
    expect(mocks.listOccurrences).toHaveBeenCalledOnce();
    cache.controller.dispose();
    warn.mockRestore();
  });

  it('shows a change made elsewhere on the next poke and pages through REST once retries stop', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const cache = staleCoveredCache();
    cacheHost = cache.host;
    const elsewhere = graphqlOccurrence({
      id: 'event-3:2026-10-08T09:00:00+00:00',
      eventId: 'event-3',
      occurrenceKey: '2026-10-08T09:00:00+00:00',
      event: graphqlEvent({ id: 'event-3', title: 'Made in another tab' }),
    });
    let onServer = [existing, created];
    mocks.listOccurrences.mockImplementation(async () =>
      ok({
        items: onServer.map(mapCalendarOccurrence),
        syncStatus: 'ready' as const,
        hasMore: false,
        nextCursor: null,
      })
    );
    const [range, setRange] = createSignal(week);
    let query!: ReturnType<typeof useCalendarOccurrencesQuery>;
    const Harness = () => {
      query = useCalendarOccurrencesQuery(() => ({
        userId: 'user-1',
        range: range(),
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
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'event-2'])
    );
    await expect(cache.controller.runDelta()).rejects.toThrow();
    cache.state.handoff = false;

    // The delta keeps failing through every retry, and then stops. The
    // first attempt failed at the refused cache read, before any fetch.
    await vi.advanceTimersByTimeAsync(
      DELTA_RETRY_BASE_MS * (2 ** MAX_DELTA_RETRIES - 1) + 1_000
    );
    expect(cache.fetchChanges).toHaveBeenCalledTimes(MAX_DELTA_RETRIES);
    for (let change = 0; change < 3; change += 1) {
      cache.cacheChanged();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(mocks.listOccurrences).toHaveBeenCalledOnce();

    // An event created elsewhere reaches this tab as the server's poke.
    onServer = [existing, created, elsewhere];
    await invalidateCalendarOccurrences();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'event-2', 'event-3'])
    );
    expect(mocks.listOccurrences).toHaveBeenCalledTimes(2);
    // The poke tried the delta once more and scheduled no retry.
    expect(cache.fetchChanges).toHaveBeenCalledTimes(MAX_DELTA_RETRIES + 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(cache.fetchChanges).toHaveBeenCalledTimes(MAX_DELTA_RETRIES + 1);

    // Paging reads the new week from REST once; cache changes add nothing.
    setRange(nextWeek);
    await vi.waitFor(() =>
      expect(mocks.listOccurrences).toHaveBeenCalledTimes(3)
    );
    expect(mocks.listOccurrences).toHaveBeenLastCalledWith(
      expect.objectContaining({ start: nextWeek.start, end: nextWeek.end })
    );
    for (let change = 0; change < 3; change += 1) {
      cache.cacheChanged();
      await vi.advanceTimersByTimeAsync(300);
    }
    expect(mocks.listOccurrences).toHaveBeenCalledTimes(3);
    cache.controller.dispose();
    warn.mockRestore();
  });

  it('reads a synced cache without REST or another delta', async () => {
    const cache = staleCoveredCache();
    cache.state.handoff = false;
    cache.state.deltaFails = false;
    cacheHost = cache.host;
    await cache.controller.runDelta();
    expect(cache.fetchChanges).toHaveBeenCalledOnce();

    const query = renderWeek();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'event-2'])
    );
    await query.refetch();
    expect(cache.fetchChanges).toHaveBeenCalledOnce();
    expect(mocks.listOccurrences).not.toHaveBeenCalled();
    cache.controller.dispose();
  });
});

const booking = graphqlOccurrence({
  id: 'booking-1:2026-10-08T14:00:00+00:00',
  eventId: 'booking-1',
  occurrenceKey: '2026-10-08T14:00:00+00:00',
  time: {
    __typename: 'GraphqlTimedEventTime',
    startsAt: '2026-10-08T14:00:00+00:00',
    endsAt: '2026-10-08T14:30:00+00:00',
    timeZone: null,
  },
  event: graphqlEvent({ id: 'booking-1', title: 'Booking' }),
});

/** A tab whose cache holds the week as current, with REST as the server. */
async function currentCacheWithBooking() {
  const cache = fakeCalendarCache([existing, booking]);
  cacheHost = cache.host;
  setActiveCalendarSyncController(cache.controller);
  const server = { occurrences: [existing, booking] };
  mocks.listOccurrences.mockImplementation(async () =>
    ok({
      items: server.occurrences.map(mapCalendarOccurrence),
      syncStatus: 'ready' as const,
      hasMore: false,
      nextCursor: null,
    })
  );
  await cache.controller.runDelta();
  /** The guest cancels: the server deletes the booking and pokes this tab. */
  const cancelBooking = () => {
    server.occurrences = [existing];
    cache.deleteOnServer('booking-1');
    return invalidateCalendarOccurrences();
  };
  return { cache, cancelBooking };
}

describe('calendar week after an event is deleted elsewhere', () => {
  it('drops it from the cache when the poke brings the cache forward', async () => {
    const { cache, cancelBooking } = await currentCacheWithBooking();
    const query = renderWeek();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'booking-1'])
    );

    await cancelBooking();

    await vi.waitFor(() => expect(eventIds(query.data)).toEqual(['event-1']));
    expect(cache.holds('booking-1')).toBe(false);
    expect(mocks.listOccurrences).not.toHaveBeenCalled();
    cache.controller.dispose();
  });

  it('drops it through REST when the delta for its poke fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { cache, cancelBooking } = await currentCacheWithBooking();
    const query = renderWeek();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'booking-1'])
    );

    cache.delta.mode = 'fail';
    await cancelBooking();

    await vi.waitFor(() => expect(eventIds(query.data)).toEqual(['event-1']));
    expect(cache.holds('booking-1')).toBe(true);
    cache.controller.dispose();
    warn.mockRestore();
  });

  it('keeps a week a pending write shaped on the cache while the delta fails', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { cache, cancelBooking } = await currentCacheWithBooking();
    const query = renderWeek();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'booking-1'])
    );

    // REST cannot show the edit still pending in this week; its settle
    // refreshes the week once the write lands.
    cache.state.pendingWrite = true;
    cache.delta.mode = 'fail';
    await cancelBooking();
    await query.refetch();

    expect(mocks.listOccurrences).not.toHaveBeenCalled();
    expect(eventIds(query.data)).toEqual(['event-1', 'booking-1']);

    cache.state.pendingWrite = false;
    await invalidateCalendarOccurrences();
    await vi.waitFor(() => expect(eventIds(query.data)).toEqual(['event-1']));
    cache.controller.dispose();
    warn.mockRestore();
  });

  it('drops it through REST while the delta for its poke is held, then reads the cache again', async () => {
    vi.useFakeTimers();
    const { cache, cancelBooking } = await currentCacheWithBooking();
    const query = renderWeek();
    await vi.waitFor(() =>
      expect(eventIds(query.data)).toEqual(['event-1', 'booking-1'])
    );

    // A cache waiting on another tab's handoff can hold the delta for minutes.
    cache.delta.mode = 'hold';
    const poke = cancelBooking();
    await vi.advanceTimersByTimeAsync(2 * CALENDAR_CACHE_READ_DEADLINE_MS);

    await vi.waitFor(() => expect(eventIds(query.data)).toEqual(['event-1']));
    const restReads = mocks.listOccurrences.mock.calls.length;
    expect(restReads).toBeGreaterThan(0);

    cache.release();
    await poke;
    await vi.advanceTimersByTimeAsync(1_000);
    expect(cache.holds('booking-1')).toBe(false);
    await query.refetch();
    expect(eventIds(query.data)).toEqual(['event-1']);
    expect(mocks.listOccurrences).toHaveBeenCalledTimes(restReads);
    cache.controller.dispose();
  });
});
