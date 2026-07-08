/**
 * @vitest-environment jsdom
 *
 * Regression tests for optimistic-update cancellation scope. A blanket
 * `cancelSoupQueries()` used to cancel every in-flight soup refetch, so an
 * invalidated destination folder's mount-refetch could be killed by any
 * unrelated optimistic write (most commonly the folder's own viewedAt
 * tracking on block open), stranding stale data until the next remount.
 * Optimistic entity patches must only cancel queries containing the entity.
 */

import type { QueryKey } from '@tanstack/solid-query';
import { QueryClient, QueryObserver } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let testQueryClient: QueryClient;

vi.mock('../../client', () => ({
  get queryClient() {
    return testQueryClient;
  },
}));

const mockNormalizer = {
  setNormalizedData: vi.fn(),
  getDependentQueriesByIds: vi.fn<(ids: string[]) => QueryKey[]>(() => []),
  getObjectById: vi.fn<(id: string) => unknown>(() => null),
};

vi.mock('./normalizer', () => ({
  getSoupNormalizer: () => mockNormalizer,
  getNormalizationObjectKey: (obj: Record<string, unknown>) => {
    if ('tag' in obj && 'data' in obj) {
      const data = obj.data as Record<string, unknown>;
      if (obj.tag === 'channel') {
        const channel = data?.channel as Record<string, unknown> | undefined;
        return channel?.id ? `soup:${channel.id}` : undefined;
      }
      return data?.id ? `soup:${data.id}` : undefined;
    }
    return undefined;
  },
  SOUP_NORM_PREFIX: 'soup:',
  soupNormKey: (id: string) => `soup:${id}`,
  stripSoupNormPrefix: (normKey: string) => normKey.slice('soup:'.length),
}));

vi.mock('../recently-viewed', () => ({
  updateRecentlyViewedItem: vi.fn(),
}));

import { soupKeys } from '../keys';
import {
  invalidateSoupQueriesReferencing,
  optimisticUpdateSoupEntity,
  optimisticUpdateSoupItemViewedAt,
} from './operations';

const FOLDER_ID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeffff0000';
// Mirrors a project-scoped astItems key: the folder UUID appears in the
// compiled filter AST, which is what invalidateSoupQueriesReferencing matches.
const folderContentsKey = [
  ...soupKeys.astItems._def,
  { limit: 100, sort_method: 'updated_at' },
  { df: { l: { pid: FOLDER_ID } } },
];
// A list that contains the moved/patched entity (e.g. the source inbox).
const sourceListKey = [...soupKeys.astItems._def, { limit: 100 }, { ef: {} }];

const STALE_TIME = 5 * 60 * 1000; // prod default

/** Per-key controllable query: fetches block until released. */
function makeQueryController(queryKey: QueryKey, initialItems: string[]) {
  let items = initialItems;
  const pending: Array<() => void> = [];

  const queryFn = vi.fn(async () => {
    const snapshot = items;
    await new Promise<void>((resolve) => {
      pending.push(resolve);
    });
    return snapshot;
  });

  return {
    queryFn,
    setServerItems(next: string[]) {
      items = next;
    },
    mount() {
      const observer = new QueryObserver<string[]>(
        testQueryClient,
        testQueryClient.defaultQueryOptions({
          queryKey,
          queryFn,
          staleTime: STALE_TIME,
        })
      );
      const unsubscribe = observer.subscribe(() => {});
      return { observer, unsubscribe };
    },
    async releaseNextFetch() {
      await vi.waitFor(() => {
        expect(pending.length).toBeGreaterThan(0);
      });
      pending.shift()!();
      // Let the retryer resolve and the cache settle.
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    state() {
      return testQueryClient.getQueryCache().find({ queryKey })!.state;
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockNormalizer.getDependentQueriesByIds.mockReturnValue([]);
  mockNormalizer.getObjectById.mockReturnValue(null);
  testQueryClient = new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: STALE_TIME,
        gcTime: 10 * 60 * 1000,
        refetchOnWindowFocus: false,
        retry: false,
      },
    },
  });
});

afterEach(() => {
  testQueryClient.clear();
});

/**
 * Shared setup: open the folder (fetch v1), close it, move an email in while
 * it's closed (server updated + destination invalidation), then remount so
 * the invalidated query starts its mount-refetch.
 */
async function openMoveAndRemount(
  folder: ReturnType<typeof makeQueryController>
) {
  const first = folder.mount();
  await folder.releaseNextFetch();
  expect(first.observer.getCurrentResult().data).toEqual(['old-email']);
  first.unsubscribe();

  folder.setServerItems(['old-email', 'moved-email']);
  invalidateSoupQueriesReferencing([FOLDER_ID]);
  expect(folder.state().isInvalidated).toBe(true);
  expect(folder.state().fetchStatus).toBe('idle'); // inactive: marked only

  const second = folder.mount();
  await vi.waitFor(() => {
    expect(folder.state().fetchStatus).toBe('fetching');
  });
  return second;
}

describe('destination-folder refetch vs optimistic soup updates', () => {
  it('control: with nothing interfering the mount-refetch lands', async () => {
    const folder = makeQueryController(folderContentsKey, ['old-email']);
    const { observer } = await openMoveAndRemount(folder);

    await folder.releaseNextFetch();

    expect(observer.getCurrentResult().data).toEqual([
      'old-email',
      'moved-email',
    ]);
  });

  it('an optimistic update for an entity outside the folder does not cancel the refetch', async () => {
    const folder = makeQueryController(folderContentsKey, ['old-email']);
    const { observer } = await openMoveAndRemount(folder);

    // E.g. a debounced mark-as-seen for a thread in another list.
    optimisticUpdateSoupEntity({
      tag: 'emailThread',
      data: { id: 'unrelated-thread', isRead: true },
      frecency_score: 0,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    await folder.releaseNextFetch();

    expect(observer.getCurrentResult().data).toEqual([
      'old-email',
      'moved-email',
    ]);
  });

  it("the folder's own viewedAt tracking on open does not cancel its contents refetch", async () => {
    const folder = makeQueryController(folderContentsKey, ['old-email']);
    const { observer } = await openMoveAndRemount(folder);

    // trackBlockOpened.track() fires on the same navigation that mounted the
    // folder. The folder entity lives in other lists (folders view etc.), not
    // in its own contents query.
    mockNormalizer.getObjectById.mockReturnValue({
      tag: 'project',
      data: { id: FOLDER_ID, name: 'folder' },
      frecency_score: 1,
    });
    mockNormalizer.getDependentQueriesByIds.mockReturnValue([sourceListKey]);
    optimisticUpdateSoupItemViewedAt(FOLDER_ID);

    await folder.releaseNextFetch();

    expect(observer.getCurrentResult().data).toEqual([
      'old-email',
      'moved-email',
    ]);
  });

  it('still cancels in-flight refetches of queries containing the entity', async () => {
    const source = makeQueryController(sourceListKey, ['thread-1']);
    const { observer } = source.mount();
    await source.releaseNextFetch();
    expect(observer.getCurrentResult().data).toEqual(['thread-1']);

    // Active observer + invalidation → refetch in flight.
    testQueryClient.invalidateQueries({ queryKey: sourceListKey });
    await vi.waitFor(() => {
      expect(source.state().fetchStatus).toBe('fetching');
    });

    // Optimistic patch of an entity in this list must cancel the refetch so
    // the (pre-mutation) response can't clobber the patch.
    mockNormalizer.getDependentQueriesByIds.mockReturnValue([sourceListKey]);
    optimisticUpdateSoupEntity({
      tag: 'emailThread',
      data: { id: 'thread-1', isRead: true },
      frecency_score: 0,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    await vi.waitFor(() => {
      expect(source.state().fetchStatus).toBe('idle');
    });
    // The stale in-flight response is discarded.
    source.setServerItems(['should-not-land']);
    await source.releaseNextFetch();
    expect(observer.getCurrentResult().data).toEqual(['thread-1']);
  });

  it('channel-shaped partials (nested id) still cancel dependent queries', async () => {
    const source = makeQueryController(sourceListKey, ['channel-1']);
    const { observer } = source.mount();
    await source.releaseNextFetch();

    testQueryClient.invalidateQueries({ queryKey: sourceListKey });
    await vi.waitFor(() => {
      expect(source.state().fetchStatus).toBe('fetching');
    });

    mockNormalizer.getDependentQueriesByIds.mockReturnValue([sourceListKey]);
    optimisticUpdateSoupEntity({
      tag: 'channel',
      data: { channel: { id: 'channel-1' }, viewed_at: 'now' },
      frecency_score: 1,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    await vi.waitFor(() => {
      expect(source.state().fetchStatus).toBe('idle');
    });
    // Cancelled because the channel's norm key resolved and mapped to this
    // dependent — a broken channel key derivation would leave this fetching.
    expect(mockNormalizer.getDependentQueriesByIds).toHaveBeenCalledWith([
      'soup:channel-1',
    ]);
    source.setServerItems(['should-not-land']);
    await source.releaseNextFetch();
    expect(observer.getCurrentResult().data).toEqual(['channel-1']);
  });

  it('does not cancel a dependent query mid initial fetch (no data yet)', async () => {
    const source = makeQueryController(sourceListKey, ['thread-1']);
    const { observer } = source.mount();
    // Initial fetch in flight, data === undefined.
    await vi.waitFor(() => {
      expect(source.state().fetchStatus).toBe('fetching');
    });

    mockNormalizer.getDependentQueriesByIds.mockReturnValue([sourceListKey]);
    optimisticUpdateSoupEntity({
      tag: 'emailThread',
      data: { id: 'thread-1', isRead: true },
      frecency_score: 0,
    } as unknown as Parameters<typeof optimisticUpdateSoupEntity>[0]);

    // The cold fetch survives and lands instead of being stranded pending.
    expect(source.state().fetchStatus).toBe('fetching');
    await source.releaseNextFetch();
    expect(observer.getCurrentResult().data).toEqual(['thread-1']);
    expect(source.state().status).toBe('success');
  });
});
