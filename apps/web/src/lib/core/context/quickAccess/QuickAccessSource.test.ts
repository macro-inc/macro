import type { CrmCompanyEntity } from '@entity';
import type { CacheChangeOptions } from '@graphql-cache/host/types';
import type {
  SearchCacheArgs,
  SearchCachePage,
  SearchDocumentWire,
} from '@graphql-cache/index';
import { INITIAL_CACHE_REVISION } from '@graphql-cache/index';
import type { HistoryItem } from '@queries/history/types';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MAX_BROWSE_PAGES_PER_LOAD } from './projected-list';
import { createQuickAccessValue } from './QuickAccessSource';
import {
  BUCKET_COMBINATIONS,
  type Bucket,
  type QuickAccessContextValue,
} from './types';

const mocks = vi.hoisted(() => ({
  search: vi.fn<(args: SearchCacheArgs) => Promise<SearchCachePage>>(),
  history: [] as HistoryItem[],
  changed: undefined as (() => void) | undefined,
  unsubscribe: vi.fn(),
  channelRefetch: vi.fn(),
  onCacheChanged: vi.fn(),
  readRecordsByKeys: vi.fn(),
  companies: [] as CrmCompanyEntity[],
  crmEnabled: (): boolean => true,
  cacheEnabled: true,
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableCrm: {},
  isFeatureEnabled: () => mocks.crmEnabled(),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: mocks.crmEnabled() }),
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
    documents
      .filter((document) => document.bucket === 'note')
      .map((document) => ({
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
  useQuickAccessCrmCompaniesQuery: () => ({
    query: {},
    companies: () => mocks.companies,
  }),
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
    readRecordsByKeys: mocks.readRecordsByKeys,
    disabled: !mocks.cacheEnabled,
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
  mocks.companies = [];
  mocks.crmEnabled = () => true;
  mocks.cacheEnabled = true;
  mocks.readRecordsByKeys.mockReset().mockResolvedValue({
    revision: INITIAL_CACHE_REVISION,
    records: [
      { recordKey: 'GraphqlSoupCrmCompany:company-1', record: cachedCompany },
    ],
  });
  mocks.search.mockReset().mockResolvedValue(page(0, 0));
  mocks.onCacheChanged.mockImplementation(
    (callback: () => void, _options: CacheChangeOptions) => {
      mocks.changed = callback;
      return mocks.unsubscribe;
    }
  );
});
afterEach(() => dispose?.());

const cachedCompany = {
  __typename: 'GraphqlSoupCrmCompany',
  name: 'Acme',
  teamId: 'team-1',
  hidden: false,
  domains: ['acme.example'],
  createdAt: '2025-01-01T00:00:00.000Z',
  updatedAt: '2025-01-02T00:00:00.000Z',
  viewedAt: null,
};
const companyHit: SearchDocumentWire = {
  profile: 'quick-access-v1',
  recordKey: 'GraphqlSoupCrmCompany:company-1',
  bucket: 'crm_company',
  searchText: 'acme | acme.example',
  timestampMs: Date.parse(cachedCompany.updatedAt),
  sourceHash: 'company-hash',
};
const restCompany: CrmCompanyEntity = {
  id: 'company-1',
  type: 'crm_company',
  name: 'Acme',
  teamId: 'team-1',
  ownerId: 'team-1',
  hidden: false,
  domains: [{ id: 'domain-1', companyId: 'company-1', domain: 'acme.example' }],
};

describe('Quick Access source integration', () => {
  it.each(['Acme', 'acme.example'])(
    'finds a cached CRM company absent from the REST feed by %s',
    async (query) => {
      mocks.search.mockResolvedValue({
        documents: [companyHit],
        nextCursor: null,
      });
      const list = setup((source) =>
        source.useList({ buckets: ['crm_company'], searchTerm: () => query })
      );
      await vi.waitFor(() => expect(list.items()).toHaveLength(1));
      expect(mocks.search).toHaveBeenCalledWith(
        expect.objectContaining({ buckets: ['crm_company'], query })
      );
      expect(list.items()[0]).toMatchObject({
        id: 'company-1',
        kind: 'entity',
        bucket: 'crm_company',
        data: {
          type: 'crm_company',
          name: 'Acme',
          teamId: 'team-1',
          domains: [expect.objectContaining({ domain: 'acme.example' })],
        },
      });
      expect(list.totalCount()).toBe(1);
    }
  );

  it('merges CRM cache hits with the REST feed without duplicates', async () => {
    mocks.companies = [restCompany];
    mocks.search.mockResolvedValue({
      documents: [companyHit],
      nextCursor: null,
    });
    const list = setup((source) =>
      source.useList({ buckets: ['crm_company'], searchTerm: () => 'Acme' })
    );
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(list.items()).toHaveLength(1);
    expect(list.items()[0].data).toMatchObject(restCompany);
  });

  it('preserves REST company mentions with GraphQL disabled', () => {
    mocks.cacheEnabled = false;
    mocks.companies = [restCompany];
    const list = setup((source) =>
      source.useList({
        buckets: ['crm_company'],
        searchTerm: () => 'acme.example',
      })
    );
    expect(list.items()).toHaveLength(1);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('updates an open company list when the cache is hydrated', async () => {
    const list = setup((source) =>
      source.useList({ buckets: ['crm_company'] })
    );
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(list.items()).toEqual([]);
    mocks.search.mockResolvedValue({
      documents: [companyHit],
      nextCursor: null,
    });
    mocks.changed?.();
    await vi.waitFor(() => expect(list.items()).toHaveLength(1));
  });

  it('does not search cached companies when CRM is disabled', () => {
    mocks.crmEnabled = () => false;
    mocks.companies = [restCompany];
    const list = setup((source) =>
      source.useList({ buckets: ['crm_company'] })
    );
    expect(list.items()).toEqual([]);
    expect(mocks.search).not.toHaveBeenCalled();
  });

  it('excludes CRM from mixed lists when the feature is disabled', async () => {
    mocks.crmEnabled = () => false;
    mocks.companies = [restCompany];
    const list = setup((source) =>
      source.useList({ buckets: ['note', 'crm_company'] })
    );
    await vi.waitFor(() => expect(list.isLoading()).toBe(false));
    expect(mocks.search).toHaveBeenCalledWith(
      expect.objectContaining({ buckets: ['note'] })
    );
    expect(list.items()).toEqual([]);
  });

  it.each([true, false])(
    'filters retained local CRM companies across list selections (GraphQL %s)',
    async (cacheEnabled) => {
      mocks.cacheEnabled = cacheEnabled;
      mocks.crmEnabled = () => false;
      mocks.companies = [restCompany];
      mocks.history = [
        {
          id: 'note-1',
          type: 'document',
          name: 'Note',
          fileType: 'md',
          ownerId: 'owner',
        },
        {
          id: 'chat-1',
          type: 'chat',
          name: 'Chat',
          ownerId: 'owner',
          isPersistent: true,
        },
      ];
      const lists = setup((source) => [
        { list: source.useList(), ids: ['chat-1', 'note-1'] },
        { list: source.useList({ buckets: [] }), ids: ['chat-1', 'note-1'] },
        { list: source.useList('crm_company'), ids: [] },
        { list: source.useList({ buckets: ['crm_company'] }), ids: [] },
        {
          list: source.useList({ buckets: ['note', 'crm_company'] }),
          ids: ['note-1'],
        },
        {
          list: source.useList({
            buckets: [...BUCKET_COMBINATIONS.documents, 'crm_company'],
          }),
          ids: ['chat-1', 'note-1'],
        },
        {
          list: source.useList({ buckets: ['note', 'chat', 'crm_company'] }),
          ids: ['chat-1', 'note-1'],
        },
        {
          list: source.useList({ buckets: BUCKET_COMBINATIONS.all }),
          ids: ['chat-1', 'note-1'],
        },
      ]);
      await vi.waitFor(() =>
        expect(lists.every(({ list }) => !list.isLoading())).toBe(true)
      );
      for (const { list, ids } of lists) {
        expect(
          list
            .items()
            .map((item) => item.id)
            .sort()
        ).toEqual(ids);
        expect(list.totalCount()).toBe(ids.length);
      }
    }
  );

  it.each([true, false])(
    'updates long-lived local lists when CRM flags load or turn off (GraphQL %s)',
    async (cacheEnabled) => {
      const [crmEnabled, setCrmEnabled] = createSignal(false);
      mocks.crmEnabled = crmEnabled;
      mocks.cacheEnabled = cacheEnabled;
      mocks.companies = [restCompany];
      const lists = setup((source) => [
        source.useList(),
        source.useList({ buckets: [] }),
        source.useList({ buckets: ['crm_company'] }),
        source.useList({ buckets: ['note', 'crm_company'] }),
      ]);
      await vi.waitFor(() =>
        expect(lists.every((list) => !list.isLoading())).toBe(true)
      );
      for (const list of lists) expect(list.items()).toEqual([]);

      setCrmEnabled(true);
      await vi.waitFor(() => {
        for (const list of lists)
          expect(list.items().map((item) => item.id)).toEqual(['company-1']);
      });
      setCrmEnabled(false);
      await vi.waitFor(() => {
        for (const list of lists) expect(list.items()).toEqual([]);
      });
    }
  );

  it.each([
    { buckets: ['crm_company'] },
    { buckets: ['note', 'crm_company'] },
  ] satisfies { buckets: Bucket[] }[])(
    'updates cached-only companies when flags change for $buckets',
    async ({ buckets }) => {
      const [crmEnabled, setCrmEnabled] = createSignal(false);
      mocks.crmEnabled = crmEnabled;
      mocks.search.mockImplementation(async (args) => ({
        documents: args.buckets?.includes('crm_company') ? [companyHit] : [],
        nextCursor: null,
      }));
      const list = setup((source) => source.useList({ buckets }));
      await vi.waitFor(() => expect(list.isLoading()).toBe(false));
      expect(list.items()).toEqual([]);
      setCrmEnabled(true);
      await vi.waitFor(() => expect(list.items()).toHaveLength(1));
      expect(mocks.search).toHaveBeenLastCalledWith(
        expect.objectContaining({ buckets })
      );
      setCrmEnabled(false);
      await vi.waitFor(() => expect(list.items()).toEqual([]));
      expect(list.hasMore()).toBe(false);
    }
  );

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
