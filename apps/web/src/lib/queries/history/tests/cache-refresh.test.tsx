import type {
  CacheChangeListener,
  CacheChangeOptions,
} from '@graphql-cache/host/types';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/protocol';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { err, ok } from 'neverthrow';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { refetchHistory, removeHistoryItem, useHistoryQuery } from '../history';

const mocks = vi.hoisted(() => ({
  readHistory: vi.fn(),
  fetchHistory: vi.fn(),
  hydrateDocuments: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
  invalidateQueries: vi.fn(),
  removeHistory: vi.fn(),
  deleteRecords: vi.fn(),
  graphqlEnabled: vi.fn(),
  setQueryData: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: {},
  isFeatureEnabled: mocks.graphqlEnabled,
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name: string }) => item.name,
}));
vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: {
    getUsersHistory: mocks.fetchHistory,
    removeItemFromUserHistory: mocks.removeHistory,
  },
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({
    onCacheChanged: mocks.subscribe,
    currentStorageGeneration: async () => 'history-storage',
    deleteRecords: mocks.deleteRecords,
  }),
  getGraphqlSoupClient: () => ({}),
}));
vi.mock('@queries/history/graphql', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../graphql')>()),
  readCachedGraphqlHistoryItems: mocks.readHistory,
}));
vi.mock('@queries/client', () => ({
  queryClient: {
    invalidateQueries: mocks.invalidateQueries,
    setQueryData: mocks.setQueryData,
  },
}));
vi.mock('@queries/utils', () => ({ withCallbacks: vi.fn() }));
vi.mock('../known-documents', () => ({
  hydrateKnownGraphqlDocuments: mocks.hydrateDocuments,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readHistory.mockReset();
  mocks.fetchHistory.mockResolvedValue(ok({ data: [] }));
  mocks.hydrateDocuments.mockResolvedValue(undefined);
  mocks.graphqlEnabled.mockReturnValue(true);
  mocks.removeHistory.mockResolvedValue(ok({ success: true }));
  mocks.deleteRecords.mockResolvedValue([]);
  vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('history removal', () => {
  it('evicts a removed document before refreshing the independent cache projection', async () => {
    expect(await removeHistoryItem('document', 'link-only')).toBe(true);
    expect(mocks.deleteRecords).toHaveBeenCalledWith([
      'GraphqlSoupDocument:link-only',
    ]);
    expect(mocks.deleteRecords.mock.invocationCallOrder[0]).toBeLessThan(
      mocks.invalidateQueries.mock.invocationCallOrder[0]
    );
  });

  it('keeps the projection when server-side removal fails', async () => {
    mocks.removeHistory.mockResolvedValue(err(new Error('offline')));
    expect(await removeHistoryItem('document', 'link-only')).toBe(false);
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('does not evict non-document projections or change the REST fallback', async () => {
    expect(await removeHistoryItem('chat', 'chat-1')).toBe(true);
    mocks.graphqlEnabled.mockReturnValue(false);
    expect(await removeHistoryItem('document', 'link-only')).toBe(true);
    expect(mocks.deleteRecords).not.toHaveBeenCalled();
  });

  it('does not report a completed history removal as failed when local eviction fails', async () => {
    vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    mocks.deleteRecords.mockRejectedValueOnce(new Error('cache unavailable'));
    expect(await removeHistoryItem('document', 'link-only')).toBe(true);
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['history'],
    });
  });
});

describe('cache-backed history refresh', () => {
  it('invalidates cached candidates before refreshing GraphQL and REST history', async () => {
    await refetchHistory();
    expect(mocks.invalidateQueries).toHaveBeenCalledWith({
      queryKey: ['history'],
    });
  });
  it('recovers only known document IDs from persisted history before reading the projection', async () => {
    mocks.subscribe.mockReturnValue(mocks.unsubscribe);
    mocks.fetchHistory.mockResolvedValue(
      ok({
        data: [
          {
            id: 'link-only',
            type: 'document',
            owner: 'owner',
            name: 'CRM plan',
            fileType: 'md',
          },
          { id: 'chat-1', type: 'chat', userId: 'owner', name: 'Chat' },
        ],
      })
    );
    mocks.readHistory.mockResolvedValue([
      { id: 'link-only', type: 'document', name: 'CRM plan', ownerId: 'owner' },
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
    try {
      await waitFor(() => expect(query?.isSuccess).toBe(true));
      expect(mocks.hydrateDocuments.mock.calls[0]?.[2]).toEqual(['link-only']);
      expect(mocks.hydrateDocuments.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.readHistory.mock.invocationCallOrder[0]
      );
      expect(query?.data?.map((item) => item.id)).toEqual(['link-only']);
      mocks.hydrateDocuments.mockImplementationOnce(async () => {
        mocks.readHistory.mockResolvedValue([]);
      });
      await query?.refetch();
      expect(query?.data).toEqual([]);
      expect(mocks.fetchHistory).toHaveBeenCalledOnce();
      expect(mocks.hydrateDocuments).toHaveBeenCalledTimes(2);
    } finally {
      view.unmount();
      client.clear();
    }
  });

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
    expect(mocks.fetchHistory).toHaveBeenCalledOnce();
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
      expect(mocks.fetchHistory).toHaveBeenCalledOnce();
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
    expect(mocks.fetchHistory).toHaveBeenCalledOnce();
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    client.clear();
  });
});
