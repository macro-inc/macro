import type {
  CacheChangeListener,
  CacheChangeOptions,
} from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { unwrap } from 'solid-js/store';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryQuery } from '../history';
import { historyKeys } from '../keys';

const mocks = vi.hoisted(() => ({
  readHistory: vi.fn(),
  fetchHistory: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/context/user', () => ({ useIsAuthenticated: () => () => true }));

vi.mock('@core/constant/featureFlags', () => ({ enableGraphqlSoup: {} }));
vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name: string }) => item.name,
}));
vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getUsersHistory: mocks.fetchHistory },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({ onCacheChanged: mocks.subscribe }),
}));
vi.mock('@queries/history/graphql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../graphql')>()),
  readCachedGraphqlHistoryItems: mocks.readHistory,
}));
vi.mock('@queries/client', () => ({ queryClient: {} }));
vi.mock('@queries/utils', () => ({ withCallbacks: vi.fn() }));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readHistory.mockReset();
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('history readers', () => {
  // A reader that walks the list unwrapped only sees a change that replaces
  // the list; the default reader updates its rows in place instead.
  it('replaces the list on every change only for a reader that asks not to reconcile', async () => {
    mocks.subscribe.mockReturnValue(mocks.unsubscribe);
    const row = { id: 'row', name: 'Before', type: 'document', ownerId: 'o' };
    mocks.readHistory.mockResolvedValue([row]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let rows: ReturnType<typeof useHistoryQuery> | undefined;
    let snapshots: ReturnType<typeof useHistoryQuery> | undefined;
    const Probe = () => {
      rows = useHistoryQuery();
      snapshots = useHistoryQuery({ reconcile: false });
      return null;
    };
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(snapshots?.isSuccess).toBe(true));
    await waitFor(() => expect(rows?.isSuccess).toBe(true));
    const reconciled = unwrap(rows?.data);
    const replaced = unwrap(snapshots?.data);

    client.setQueryData(historyKeys.graphqlList.queryKey, [
      { ...row, name: 'After' },
    ]);
    await waitFor(() => expect(snapshots?.data?.[0]?.name).toBe('After'));
    await waitFor(() => expect(rows?.data?.[0]?.name).toBe('After'));
    expect(unwrap(snapshots?.data)).not.toBe(replaced);
    expect(unwrap(rows?.data)).toBe(reconciled);
    view.unmount();
    client.clear();
  });
});

describe('cache-backed history refresh', () => {
  it('coalesces hidden cache changes without hiding the previous history', async () => {
    const visibility = vi.spyOn(document, 'visibilityState', 'get');
    let notify: (() => void) | undefined;
    mocks.subscribe.mockImplementation((callback: () => void) => {
      notify = callback;
      return mocks.unsubscribe;
    });
    const original = {
      id: 'original',
      name: 'Original task',
      type: 'document',
      ownerId: 'owner',
    };
    const latest = { ...original, name: 'Updated task' };
    mocks.readHistory.mockResolvedValue([original]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let query: ReturnType<typeof useHistoryQuery> | undefined;
    const Probe = () => {
      query = useHistoryQuery();
      return null;
    };
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(query?.isSuccess).toBe(true));
    const initialCalls = mocks.readHistory.mock.calls.length;
    vi.useFakeTimers();
    visibility.mockReturnValue('hidden');
    document.dispatchEvent(new Event('visibilitychange'));
    mocks.readHistory.mockResolvedValue([latest]);
    notify?.();
    notify?.();
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.readHistory).toHaveBeenCalledTimes(initialCalls);
    expect(query?.data).toEqual([original]);

    visibility.mockReturnValue('visible');
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.readHistory).toHaveBeenCalledTimes(initialCalls + 1);
    expect(query?.data).toEqual([latest]);
    expect(mocks.fetchHistory).not.toHaveBeenCalled();
    view.unmount();
    client.clear();
  });

  it('populates initially empty history during a slow hydration burst, then catches up once', async () => {
    let notify: (() => void) | undefined;
    mocks.subscribe.mockImplementation((callback: () => void) => {
      notify = callback;
      return mocks.unsubscribe;
    });
    const first = [
      { id: 'first', name: 'First', type: 'document', ownerId: 'owner' },
    ];
    const latest = [...first, { ...first[0], id: 'latest' }];
    let finishFirst!: (data: typeof first) => void;
    let finishLatest!: (data: typeof first) => void;
    mocks.readHistory
      .mockResolvedValueOnce([])
      .mockReturnValueOnce(
        new Promise<typeof first>((resolve) => {
          finishFirst = resolve;
        })
      )
      .mockReturnValueOnce(
        new Promise<typeof first>((resolve) => {
          finishLatest = resolve;
        })
      );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let query: ReturnType<typeof useHistoryQuery> | undefined;
    const Probe = () => {
      query = useHistoryQuery();
      return null;
    };
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    try {
      await waitFor(() => expect(query?.isSuccess).toBe(true));
      expect(query?.data).toEqual([]);
      vi.useFakeTimers();
      notify?.();
      for (let i = 0; i < 8; i++) {
        notify?.();
        await vi.advanceTimersByTimeAsync(250);
      }
      expect(mocks.readHistory).toHaveBeenCalledTimes(2);
      finishFirst(first);
      await vi.advanceTimersByTimeAsync(250);
      expect(query?.data).toEqual(first);
      expect(mocks.readHistory).toHaveBeenCalledTimes(3);
      finishLatest(latest);
      await vi.advanceTimersByTimeAsync(1000);
      expect(query?.data).toEqual(latest);
      expect(mocks.readHistory).toHaveBeenCalledTimes(3);
      expect(mocks.fetchHistory).not.toHaveBeenCalled();
    } finally {
      view.unmount();
      client.clear();
    }
  });

  it('ignores unrelated hydration but discovers newly hydrated documents', async () => {
    let notify: CacheChangeListener | undefined;
    mocks.subscribe.mockImplementation(
      (callback: CacheChangeListener, options: CacheChangeOptions) => {
        expect(options).toEqual({ includeHydration: true });
        notify = callback;
        return mocks.unsubscribe;
      }
    );
    mocks.readHistory.mockResolvedValueOnce([]).mockResolvedValue([
      {
        id: 'new-document',
        name: 'New document',
        type: 'document',
        ownerId: 'owner',
      },
    ]);
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    let query: ReturnType<typeof useHistoryQuery> | undefined;
    const Probe = () => {
      query = useHistoryQuery();
      return null;
    };
    const view = render(() => (
      <QueryClientProvider client={client}>
        <Probe />
      </QueryClientProvider>
    ));
    await waitFor(() => expect(query?.isSuccess).toBe(true));
    expect(query?.data).toEqual([]);
    const callsBefore = mocks.readHistory.mock.calls.length;
    vi.useFakeTimers();
    notify?.(INITIAL_CACHE_REVISION, { searchChangedBuckets: ['email'] });
    notify?.(INITIAL_CACHE_REVISION, {
      searchChangedBuckets: ['channel', 'dm'],
    });
    notify?.(INITIAL_CACHE_REVISION, { searchChangedBuckets: [] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(mocks.readHistory).toHaveBeenCalledTimes(callsBefore);
    notify?.(INITIAL_CACHE_REVISION, { searchChangedBuckets: ['note'] });
    await vi.advanceTimersByTimeAsync(1000);
    expect(query?.data).toHaveLength(1);
    expect(mocks.fetchHistory).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    client.clear();
  });
});
