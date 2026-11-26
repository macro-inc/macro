import { useInfiniteQuery } from '@tanstack/solid-query';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({
  restPending: false,
  restNextPageError: false,
  restPlaceholder: false,
  restData: undefined as SoupAstItemsData | undefined,
}));
const restNext = vi.hoisted(() => vi.fn(async () => undefined));

const restRefetch = vi.hoisted(() =>
  vi.fn<() => Promise<void>>().mockResolvedValue()
);
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
    isFetchNextPageError: vi.fn(() => false),
    isPlaceholderData: vi.fn(() => false),
    hasNextPage: vi.fn(() => false),
    hasPageData: vi.fn(() => false),
    fetchNextPage: vi.fn(async () => undefined),
    resetToInitialPage: vi.fn(),
    refresh: vi.fn(async () => undefined),
  };
}

vi.mock('@app/features/next-soup/filters/query-filters', () => ({
  filterSoupItemByRequestBody: vi.fn(() => true),
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
    astItems: vi.fn(() => ({ queryKey: ['soup', 'ast'] })),
  },
}));
vi.mock('@queries/soup/transform-utils', () => ({
  isDisplayableSoupItem: vi.fn(() => true),
  mapApiSoupItemToEntity: vi.fn((item) => ({
    ...item.data,
    touchedAt: item.touched_at,
  })),
  mapSoupPageToEntityList: vi.fn((page) =>
    page.items.map((item: { data: unknown }) => item.data)
  ),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getSoupItems: vi.fn(), getSoupAstItems: fetchSoup },
}));
vi.mock('@tanstack/solid-query', () => ({
  infiniteQueryOptions: vi.fn((options: unknown) => options),
  useInfiniteQuery: vi.fn(() => ({
    get data() {
      return testState.restData;
    },
    error: null,
    get isPending() {
      return testState.restPending;
    },
    isLoading: false,
    isFetching: false,
    get isPlaceholderData() {
      return testState.restPlaceholder;
    },
    isFetchingNextPage: false,
    get isFetchNextPageError() {
      return testState.restNextPageError;
    },
    isEnabled: true,
    hasNextPage: false,
    fetchNextPage: restNext,
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
import { makeGraphqlGroupedSoupInput } from './graphql/ast';
import { createGraphqlGroupedSoupAstItemsQuery } from './graphql/grouped-items';
import { createGraphqlSoupAstItemsQuery } from './graphql/items';
import {
  type SoupAstItemsData,
  type SoupAstItemsPage,
  type SoupAstItemsQuery,
  useSoupAstItemsQuery,
} from './items';

let disposeRoot: (() => void) | undefined;

function mountGroupedQuery(
  networkPaused = false,
  transport?: 'rest'
): SoupAstItemsQuery {
  let query: SoupAstItemsQuery | undefined;
  createRoot((dispose) => {
    disposeRoot = dispose;
    query = useSoupAstItemsQuery(
      () => ({
        params: {},
        body: {},
        groupBy: {
          type: 'property',
          propertyDefinitionId: 'priority',
          entityType: 'TASK',
        },
        transport,
      }),
      () => ({ networkPaused })
    );
  });
  return query!;
}

describe('Soup refetch transport selection', () => {
  beforeEach(() => {
    testState.restPending = false;
    testState.restNextPageError = false;
    testState.restPlaceholder = false;
    testState.restData = undefined;
    vi.clearAllMocks();
  });

  afterEach(() => {
    disposeRoot?.();
    disposeRoot = undefined;
  });

  it('exposes paused REST requests as pending even when they are not loading', () => {
    testState.restPending = true;
    const query = mountGroupedQuery(false, 'rest');
    expect(query.isLoading).toBe(false);
    expect(query.isPending).toBe(true);
  });

  it('does not treat REST placeholder data as a resolved current page', () => {
    testState.restData = { entities: [], groups: undefined };
    testState.restPlaceholder = true;
    const query = mountGroupedQuery(false, 'rest');
    expect(query.hasPageData).toBe(false);
    testState.restPlaceholder = false;
    expect(query.hasPageData).toBe(true);
  });

  it('reports continuation-page failures from the selected transport', () => {
    const rest = mountGroupedQuery(false, 'rest');
    expect(rest.isFetchNextPageError).toBe(false);
    testState.restNextPageError = true;
    expect(rest.isFetchNextPageError).toBe(true);
    disposeRoot?.();

    const graphql = mountGroupedQuery();
    expect(graphql.transport).toBe('graphql');
    groupedQuery.isFetchNextPageError.mockReturnValueOnce(true);
    expect(graphql.isFetchNextPageError).toBe(true);
    expect(graphql.isFetchNextPageError).toBe(false);
  });

  it('keeps paused GraphQL requests pending until data or an error arrives, unless disabled', () => {
    const query = mountGroupedQuery(true);
    expect(query.transport).toBe('graphql');
    expect(query.isLoading).toBe(false);
    expect(query.isPending).toBe(true);

    groupedQuery.data.mockReturnValueOnce({ entities: [] });
    expect(query.isPending).toBe(false);

    groupedQuery.error.mockReturnValueOnce(new Error('Request failed'));
    expect(query.isPending).toBe(false);

    groupedQuery.isEnabled.mockReturnValueOnce(false);
    expect(query.isPending).toBe(false);
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

  it('uses REST refetch and skips mutation-driven GraphQL refresh when REST is requested', async () => {
    const query = mountGroupedQuery(false, 'rest');

    expect(query.transport).toBe('rest');
    await query.refetch();
    await refreshActiveGraphqlSoupQueries();

    expect(restRefetch).toHaveBeenCalledOnce();
    expect(groupedQuery.refresh).not.toHaveBeenCalled();
  });

  it.each(['inbox', 'drafts', 'sent', 'all'] as const)(
    'keeps grouped %s mail on REST even when GraphQL is explicitly requested and cached mail exists',
    async (emailView) => {
      vi.mocked(createGraphqlGroupedSoupAstItemsQuery).mockImplementationOnce(
        (args) => ({
          ...groupedQuery,
          // Use the real AST eligibility boundary, not the default supported mock.
          isSupported: () => {
            const request = args();
            if (!request.groupBy) return false;
            try {
              makeGraphqlGroupedSoupInput({
                ...request,
                groupBy: request.groupBy,
              });
              return true;
            } catch {
              return false;
            }
          },
          data: () => ({ cachedMail: true, entities: [], groups: [] }),
        })
      );
      const query = createRoot((dispose) => {
        disposeRoot = dispose;
        return useSoupAstItemsQuery(() => ({
          params: { sort_method: 'updated_at' },
          body: { emailView },
          groupBy: { type: 'date' },
          transport: 'graphql',
        }));
      });
      expect(query.transport).toBe('rest');
      expect(query.data).toBeUndefined(); // Never exposes the private cached-Mail projection.
      const restOptions = vi.mocked(useInfiniteQuery).mock.calls.at(-1)?.[0];
      expect(restOptions?.().enabled).toBe(true);
      await query.refetch();
      await refreshActiveGraphqlSoupQueries();
      expect(restRefetch).toHaveBeenCalledOnce();
      expect(groupedQuery.refresh).not.toHaveBeenCalled();
    }
  );

  it('uses GraphQL refetch and mutation-driven refresh by default', async () => {
    const query = mountGroupedQuery();

    expect(query.transport).toBe('graphql');
    await query.refetch();
    expect(groupedQuery.refresh).toHaveBeenCalledOnce();
    expect(restRefetch).not.toHaveBeenCalled();

    vi.clearAllMocks();
    await refreshActiveGraphqlSoupQueries();

    // The refresh rebuilds every loaded page; resetting first would collapse
    // a scrolled list to its first page after each mutation.
    expect(groupedQuery.resetToInitialPage).not.toHaveBeenCalled();
    expect(groupedQuery.refresh).toHaveBeenCalledOnce();
    expect(restRefetch).not.toHaveBeenCalled();
  });

  it.each(['refresh', 'refetch', 'fetchNextPage'] as const)(
    'still performs an explicit %s after a background head fails',
    async (action) => {
      const started = Promise.withResolvers<void>();
      const response = Promise.withResolvers<void>();
      restRefetch.mockImplementationOnce(() => {
        started.resolve();
        return response.promise;
      });
      let query!: SoupAstItemsQuery;
      createRoot((dispose) => {
        disposeRoot = dispose;
        query = useSoupAstItemsQuery(() => ({
          params: {},
          body: {},
          transport: 'rest',
        }));
      });
      const head = query.refreshHead();
      const failure = expect(head).rejects.toThrow('head failed');
      await started.promise;
      const explicit = query[action]();
      response.reject(new Error('head failed'));
      await failure;
      await explicit;
      expect(restRefetch).toHaveBeenCalledTimes(
        action === 'fetchNextPage' ? 1 : 2
      );
      expect(restNext).toHaveBeenCalledTimes(
        action === 'fetchNextPage' ? 1 : 0
      );
    }
  );
});
