import type { CacheChangeOptions } from '@graphql-cache/host/types';
import { render, waitFor } from '@solidjs/testing-library';
import { QueryClient, QueryClientProvider } from '@tanstack/solid-query';
import { describe, expect, it, vi } from 'vitest';
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

describe('cache-backed history refresh', () => {
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
