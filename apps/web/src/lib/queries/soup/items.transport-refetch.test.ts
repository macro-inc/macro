import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const testState = vi.hoisted(() => ({ graphqlEnabled: false }));
const restRefetch = vi.hoisted(() => vi.fn(async () => undefined));
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
  ENABLE_GRAPHQL_SOUP_FLAG: 'enable-graphql-soup',
  ENABLE_GRAPHQL_SOUP_OVERRIDE: undefined,
}));
vi.mock('@core/util/result', () => ({ throwOnErr: vi.fn() }));
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
  isInstructionsMdDoc: vi.fn(() => false),
  mapApiSoupItemToEntity: vi.fn(),
  mapSoupPageToEntityList: vi.fn(),
}));
vi.mock('@queries/storage/instructions-md', () => ({
  useInstructionsMdIdQuery: vi.fn(() => ({})),
}));
vi.mock('@service-storage/client', () => ({
  storageServiceClient: { getSoupItems: vi.fn() },
}));
vi.mock('@tanstack/solid-query', () => ({
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
import { type SoupAstItemsQuery, useSoupAstItemsQuery } from './items';

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
    vi.clearAllMocks();
  });

  afterEach(() => {
    disposeRoot?.();
    disposeRoot = undefined;
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
