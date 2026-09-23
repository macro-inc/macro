import { filterSoupItemByRequestBody } from '@app/features/next-soup/filters/query-filters';
import { mapSoupPageToEntityList } from '@queries/soup/transform-utils';
import { storageServiceClient } from '@service-storage/client';
import type { SoupApiItem, SoupPage } from '@service-storage/generated/schemas';
import { useInfiniteQuery } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ graphqlEnabled: false }));
const instructions = vi.hoisted(() => ({
  isSuccess: false,
  get data(): string {
    if (!this.isSuccess)
      throw new Error('Pending instructions must not be read');
    return 'instructions';
  },
}));
const restRefetch = vi.hoisted(() => vi.fn(async () => undefined));
const fetchSoup = vi.hoisted(() => vi.fn());
const flatQuery = vi.hoisted(() => makeGraphqlQuery(false));
const groupedQuery = vi.hoisted(() => makeGraphqlQuery(true));

function makeGraphqlQuery(enabled: boolean) {
  return {
    data: vi.fn(),
    error: vi.fn(),
    isSupported: vi.fn(() => true),
    isEnabled: vi.fn(() => enabled),
    isLoading: vi.fn(() => false),
    isFetching: vi.fn(() => false),
    isFetchingNextPage: vi.fn(() => false),
    isPlaceholderData: vi.fn(() => false),
    hasNextPage: vi.fn(() => false),
    fetchNextPage: vi.fn(async () => undefined),
    resetToInitialPage: vi.fn(),
    refresh: vi.fn(async () => undefined),
  };
}

vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  filterSoupItemByRequestBody: vi.fn(() => true),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: vi.fn(() => () => ({ enabled: testState.graphqlEnabled })),
}));
vi.mock('@core/constant/featureFlags', () => ({
  enableGraphqlSoup: { key: 'enable-graphql-soup' },
}));
vi.mock('@core/util/result', () => ({
  throwOnErr: vi.fn(async (run: () => Promise<unknown>) => await run()),
}));
vi.mock('@queries/soup/grouped/api', () => ({
  groupedSortMethod: vi.fn(),
  makeGroupComparator: vi.fn(),
  parseGroupMeta: vi.fn(),
  serializeGroupByField: vi.fn(),
}));
vi.mock('@queries/soup/keys', () => ({
  soupKeys: {
    items: (args: unknown) => ({ queryKey: ['soup', args] }),
    astItems: vi.fn(() => ({ queryKey: ['soup', 'ast'] })),
  },
}));
vi.mock('@queries/soup/transform-utils', () => ({
  isDisplayableSoupItem: vi.fn(() => true),
  isInstructionsMdDoc: vi.fn(() => false),
  mapApiSoupItemToEntity: vi.fn((item) => ({
    ...item.data,
    touchedAt: item.touched_at,
  })),
  mapSoupPageToEntityList: vi.fn((page) =>
    page.items.map((item: { data: unknown }) => item.data)
  ),
}));
vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: vi.fn(() => instructions),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getSoupItems: vi.fn(), getSoupAstItems: fetchSoup },
}));
vi.mock('@tanstack/solid-query', () => ({
  infiniteQueryOptions: (options: unknown) => options,
  useInfiniteQuery: vi.fn(() => ({
    data: undefined,
    error: null,
    isLoading: false,
    isFetching: false,
    isPlaceholderData: false,
    isFetchingNextPage: false,
    isEnabled: true,
    hasNextPage: false,
    fetchNextPage: vi.fn(async () => undefined),
    refetch: restRefetch,
  })),
}));
vi.mock('../client', () => ({
  queryClient: { setQueryData: vi.fn() },
}));
vi.mock('./graphql/items', () => ({
  createGraphqlSoupAstItemsQuery: vi.fn(() => flatQuery),
}));
vi.mock('./graphql/grouped-items', () => ({
  createGraphqlGroupedSoupAstItemsQuery: vi.fn(() => groupedQuery),
}));

import { refreshActiveGraphqlSoupQueries } from './graphql/active-queries';
import { createGraphqlSoupAstItemsQuery } from './graphql/items';
import {
  type SoupAstItemsData,
  type SoupAstItemsPage,
  type SoupAstItemsQuery,
  useSoupAstItemsQuery,
  useSoupItemsQuery,
} from './items';

let disposeRoot: (() => void) | undefined;

function mountAutoTransportQuery(): SoupAstItemsQuery {
  let query: SoupAstItemsQuery | undefined;
  createRoot((dispose) => {
    disposeRoot = dispose;
    query = useSoupAstItemsQuery(() => ({
      params: {},
      body: {},
      groupBy: {
        type: 'property',
        propertyDefinitionId: 'priority',
        entityType: 'TASK',
      },
    }));
  });
  return query!;
}

describe('Soup refetch transport selection', () => {
  beforeEach(() => {
    testState.graphqlEnabled = false;
    instructions.isSuccess = false;
    vi.clearAllMocks();
  });

  afterEach(() => {
    disposeRoot?.();
    disposeRoot = undefined;
  });

  it('snapshots list filters and instructions without retaining their accessors', async () => {
    let tags = ['first'];
    createRoot((dispose) => {
      disposeRoot = dispose;
      useSoupItemsQuery(() => ({
        params: { limit: 20 },
        body: { tag_option_ids: tags },
      }));
    });
    const readOptions = vi.mocked(useInfiniteQuery).mock
      .calls[0][0] as unknown as () => {
      queryFn: (context: { pageParam: string | null }) => Promise<unknown>;
      select: (data: { pages: SoupPage[] }) => unknown;
      meta: { itemFilter: (item: SoupApiItem) => boolean };
    };
    const first = readOptions();
    first.select({ pages: [{ items: [], next_cursor: null }] });
    expect(mapSoupPageToEntityList).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        instructionsIdQuery: { isSuccess: true, data: undefined },
      })
    );
    instructions.isSuccess = true;
    tags = ['second'];
    const second = readOptions();
    second.select({ pages: [{ items: [], next_cursor: null }] });
    expect(mapSoupPageToEntityList).toHaveBeenLastCalledWith(
      expect.anything(),
      expect.objectContaining({
        instructionsIdQuery: { isSuccess: true, data: 'instructions' },
      })
    );
    await first.queryFn({ pageParam: 'next' });
    expect(storageServiceClient.getSoupItems).toHaveBeenLastCalledWith({
      params: { cursor: 'next' },
      body: { limit: 20, tag_option_ids: ['first'] },
    });
    // Empty pages suffice for the selector above; the metadata filter forwards
    // the item unchanged, so its shape is irrelevant to this request-binding check.
    const item = { tag: 'document' } as SoupApiItem;
    first.meta.itemFilter(item);
    expect(filterSoupItemByRequestBody).toHaveBeenLastCalledWith(item, {
      tag_option_ids: ['first'],
    });
    second.meta.itemFilter(item);
    expect(filterSoupItemByRequestBody).toHaveBeenLastCalledWith(item, {
      tag_option_ids: ['second'],
    });
  });

  it('forwards the channel list projection only to the flat GraphQL query', () => {
    createRoot((dispose) => {
      disposeRoot = dispose;
      useSoupAstItemsQuery(
        () => ({ params: {}, body: {} }),
        () => ({ enabled: true, graphqlProjection: 'channel-list' })
      );
    });
    const options = vi
      .mocked(createGraphqlSoupAstItemsQuery)
      .mock.calls[0][1]();
    expect(options.projection).toBe('channel-list');
  });

  it('preserves fetched page coverage when optimistic inserts change cached membership', async () => {
    const item = {
      tag: 'chat',
      frecency_score: 0,
      is_favorited: false,
      touched_at: '2026-09-08T00:00:00Z',
      data: {
        id: 'fetched',
        name: 'Fetched',
        ownerId: 'alice',
        isPersistent: true,
        properties: [],
        createdAt: '2026-09-08T00:00:00Z',
        updatedAt: '2026-09-08T00:00:00Z',
      },
    } as const;
    fetchSoup.mockResolvedValue({ items: [item], next_cursor: 'next' });
    createRoot((dispose) => {
      disposeRoot = dispose;
      useSoupAstItemsQuery(() => ({
        params: { sort_method: 'touched_by_me' },
        body: {},
        transport: 'rest',
      }));
    });
    const createOptions = vi.mocked(useInfiniteQuery).mock.calls.at(-1)?.[0];
    if (!createOptions) throw new Error('REST query was not created');
    const options = createOptions() as unknown as {
      queryFn: (context: {
        signal: AbortSignal;
        pageParam: null;
      }) => Promise<SoupAstItemsPage>;
      select: (data: { pages: SoupAstItemsPage[] }) => SoupAstItemsData;
    };
    const page = await options.queryFn({
      signal: new AbortController().signal,
      pageParam: null,
    });
    if (page.kind !== 'flat') throw new Error('Expected a flat page');
    page.items.push({
      ...item,
      touched_at: '2025-01-01T00:00:00Z',
      data: {
        ...item.data,
        properties: [],
        id: 'cached',
      },
    });
    const selected = options.select({ pages: [page] });
    expect(selected.entities).toHaveLength(2);
    expect(selected.oldestFetchedTimestamp).toBe(
      Date.parse('2026-09-08T00:00:00Z')
    );
  });

  it('uses REST refetch and skips mutation-driven GraphQL refresh when the flag is off', async () => {
    const query = mountAutoTransportQuery();

    expect(query.transport).toBe('rest');
    await query.refetch();
    await refreshActiveGraphqlSoupQueries();

    expect(restRefetch).toHaveBeenCalledOnce();
    expect(groupedQuery.refresh).not.toHaveBeenCalled();
  });

  it('uses GraphQL refetch and mutation-driven refresh when the flag is on', async () => {
    testState.graphqlEnabled = true;
    const query = mountAutoTransportQuery();

    expect(query.transport).toBe('graphql');
    await query.refetch();
    expect(groupedQuery.refresh).toHaveBeenCalledOnce();
    expect(restRefetch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await refreshActiveGraphqlSoupQueries();

    expect(groupedQuery.resetToInitialPage).toHaveBeenCalledOnce();
    expect(groupedQuery.refresh).toHaveBeenCalledOnce();
    expect(restRefetch).not.toHaveBeenCalled();
  });
});
