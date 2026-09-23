import type { CacheChangeOptions } from '@graphql-cache/host/types';
import { cleanup, render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useHistoryQuery } from '../history';

const mocks = vi.hoisted(() => ({
  readHistory: vi.fn(),
  fetchHistory: vi.fn(),
  subscribe: vi.fn(),
  unsubscribe: vi.fn(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: true }),
}));
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
vi.mock('@queries/history/graphql', () => ({
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

  it('opts into hydration, refreshes only local history, and unsubscribes on disposal', async () => {
    let notify: (() => void) | undefined;
    mocks.subscribe.mockImplementation(
      (callback: () => void, options: CacheChangeOptions) => {
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
    notify?.();
    await waitFor(() => expect(query?.data).toHaveLength(1));
    expect(mocks.fetchHistory).not.toHaveBeenCalled();
    view.unmount();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
    client.clear();
  });
});
