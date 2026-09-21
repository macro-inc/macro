import type { CacheChangeOptions } from '@graphql-cache/host/types';
import type {
  SearchCacheArgs,
  SearchCachePage,
  SearchDocumentWire,
} from '@graphql-cache/index';
import type { HistoryItem } from '@queries/history/types';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BROWSE_PAGES_PER_LOAD } from './projected-list';
import { createQuickAccessValue } from './QuickAccessSource';
import type { QuickAccessContextValue } from './types';

const mocks = vi.hoisted(() => ({
  search: vi.fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>(),
  history: [] as HistoryItem[],
  changed: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(),
  channelRefetch: vi.fn(),
  onCacheChanged: vi.fn(),
}));
vi.mock('@core/constant/allBlocks', () => ({
  itemToSafeName: (item: { name: string }) => item.name,
}));
vi.mock('@core/context/channels', () => ({
  useChannelsContext: () => ({ channels: () => [], isLoading: () => false }),
  useDmActivityByUserId: () => () => new Map(),
}));
vi.mock('@core/user', () => ({
  useContacts: () => () => [],
  useIsConnectedSecondaryInbox: () => () => false,
}));
vi.mock('@queries/channel/channels', () => ({
  useCachedGraphqlChannelsQuery: () => ({
    data: [],
    isLoading: false,
    refetch: mocks.channelRefetch,
  }),
}));
vi.mock('@queries/channel/graphql', () => ({
  materializeCachedGraphqlChannels: async () => [],
}));
vi.mock('@queries/gate', () => ({ queryReadyGate: () => true }));
vi.mock('@queries/history/history', () => ({
  useHistoryQuery: () => ({
    data: mocks.history,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));
vi.mock('@queries/history/graphql', () => ({
  materializeCachedGraphqlHistoryItems: async (
    _host: unknown,
    documents: SearchDocumentWire[]
  ): Promise<HistoryItem[]> =>
    documents.map((document) => ({
      id: document.recordKey.split(':')[1],
      type: 'document',
      fileType: 'md',
      name: document.searchText,
      ownerId: 'owner',
    })),
}));
vi.mock('@queries/soup/quick-access-agent-sessions', () => ({
  useQuickAccessAgentSessionsQuery: () => ({ query: {}, sessions: () => [] }),
}));
vi.mock('@queries/soup/quick-access-crm-companies', () => ({
  useQuickAccessCrmCompaniesQuery: () => ({ query: {}, companies: () => [] }),
}));
vi.mock('@queries/soup/quick-access-skills', () => ({
  useQuickAccessSkillsQuery: () => ({ query: {}, skills: () => [] }),
}));
vi.mock('@queries/soup/quick-access-snippets', () => ({
  useQuickAccessSnippetsQuery: () => ({ query: {}, snippets: () => [] }),
}));
vi.mock('@queries/soup/recently-viewed', () => ({
  useRecentlyViewedSoupQuery: () => ({ data: [] }),
}));
vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: () => ({ data: undefined }),
}));
vi.mock('@service-storage/util/filename', () => ({
  formatDocumentName: (name: string) => name,
}));
vi.mock('@service-storage/graphql-soup', () => ({
  getGraphqlSoupCacheHost: () => ({
    search: mocks.search,
    onCacheChanged: mocks.onCacheChanged,
  }),
}));

let dispose: (() => void) | undefined;
function setup<T>(fn: (source: QuickAccessContextValue) => T): T {
  return createRoot((cleanup) => {
    dispose = cleanup;
    return fn(createQuickAccessValue());
  });
}
function page(start: number, count: number, more = false): SearchCachePage {
  const documents: SearchDocumentWire[] = Array.from(
    { length: count },
    (_, i) => ({
      profile: 'quick-access-v1',
      recordKey: `GraphqlSoupDocument:${start + i}`,
      bucket: 'note',
      searchText: `Document ${start + i}`,
      timestampMs: 1,
      sourceHash: 'hash',
    })
  );
  return {
    documents,
    nextCursor: more
      ? {
          recordKey: `GraphqlSoupDocument:${start + count - 1}`,
          timestampMs: 1,
        }
      : null,
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.history = [];
  mocks.search.mockReset().mockResolvedValue(page(0, 0));
  mocks.onCacheChanged.mockImplementation(
    (callback: () => void, _options: CacheChangeOptions) => {
      mocks.changed = callback;
      return mocks.unsubscribe;
    }
  );
});
afterEach(() => dispose?.());

describe('Quick Access source integration', () => {
  it('updates an open list on opted-in hydration notifications without changing its query', async () => {
    const list = setup((source) => source.useList({ buckets: ['note'] }));
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(list.items()).toEqual([]);
    expect(mocks.onCacheChanged).toHaveBeenCalledWith(expect.any(Function), {
      includeHydration: true,
    });
    mocks.search.mockResolvedValue(page(0, 1));
    mocks.changed?.();
    await vi.waitFor(() => expect(list.items()).toHaveLength(1));
    expect(mocks.channelRefetch).toHaveBeenCalledOnce();
    dispose?.();
    expect(mocks.unsubscribe).toHaveBeenCalledOnce();
  });

  it('uses one shared scan budget when hundreds of projected rows duplicate history', async () => {
    mocks.history = Array.from({ length: 500 }, (_, i) => ({
      id: String(i),
      type: 'document',
      name: `Document ${i}`,
      fileType: 'md',
      ownerId: 'owner',
    }));
    mocks.search.mockImplementation(async (args) => {
      const start = args.cursor
        ? Number(args.cursor.recordKey.split(':')[1]) + 1
        : 0;
      const count = Math.min(50, 501 - start);
      return page(start, count, start + count < 501);
    });
    const list = setup((source) => source.useList({ buckets: ['note'] }));
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(list.items()).toHaveLength(500);
    expect(mocks.search).toHaveBeenCalledTimes(1);
    await list.loadMore();
    expect(mocks.search).toHaveBeenCalledTimes(1 + MAX_BROWSE_PAGES_PER_LOAD);
    expect(list.items()).toHaveLength(500);
    expect(list.hasMore()).toBe(true);
    await list.loadMore();
    expect(mocks.search).toHaveBeenCalledTimes(
      1 + MAX_BROWSE_PAGES_PER_LOAD * 2
    );
    await list.loadMore();
    expect(list.items()).toHaveLength(501);
    expect(list.hasMore()).toBe(false);
  });

  it('loads through pages duplicated in local history until list height can grow', async () => {
    mocks.history = Array.from({ length: 80 }, (_, i) => ({
      id: String(i),
      type: 'document',
      name: `Document ${i}`,
      fileType: 'md',
      ownerId: 'owner',
    }));
    mocks.search
      .mockResolvedValueOnce(page(0, 50, true))
      .mockResolvedValueOnce(page(50, 30, true))
      .mockResolvedValueOnce(page(80, 1));
    const list = setup((source) => source.useList({ buckets: ['note'] }));
    await vi.waitFor(() => expect(list.hasMore()).toBe(true));
    expect(list.items()).toHaveLength(80);
    await list.loadMore();
    expect(list.items()).toHaveLength(81);
    expect(list.totalCount()).toBe(81);
    expect(list.hasMore()).toBe(false);
    expect(mocks.search).toHaveBeenCalledTimes(3);
  });
});
