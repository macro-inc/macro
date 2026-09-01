import { filterSoupItemByRequestBody } from '@app/features/next-soup/filters/query-filters';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_GRAPHQL_SOUP_FLAG,
  ENABLE_GRAPHQL_SOUP_OVERRIDE,
} from '@core/constant/featureFlags';
import { throwOnErr } from '@core/util/result';
import type { EntityData } from '@entity';
import {
  groupedSortMethod,
  makeGroupComparator,
  parseGroupMeta,
  serializeGroupByField,
} from '@queries/soup/grouped/api';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import { soupKeys } from '@queries/soup/keys';
import {
  isDisplayableSoupItem,
  isInstructionsMdDoc,
  mapApiSoupItemToEntity,
  mapSoupPageToEntityList,
} from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import type { ApiEntityFilterAst } from '@service-storage/generated/schemas/apiEntityFilterAst';
import type { EntityFilters } from '@service-storage/generated/schemas/entityFilters';
import type { Params } from '@service-storage/generated/schemas/params';
import type { PostSoupAstRequestAllOf } from '@service-storage/generated/schemas/postSoupAstRequestAllOf';
import type { PostSoupRequest } from '@service-storage/generated/schemas/postSoupRequest';
import {
  type InfiniteData,
  type StaleTime,
  useInfiniteQuery,
} from '@tanstack/solid-query';
import { type Accessor, onCleanup } from 'solid-js';
import { queryClient } from '../client';
import { registerActiveGraphqlSoupQuery } from './graphql/active-queries';
import { createGraphqlGroupedSoupAstItemsQuery } from './graphql/grouped-items';
import { createGraphqlSoupAstItemsQuery } from './graphql/items';
import {
  createSoupRequestSignal,
  SOUP_NETWORK_QUERY_OPTIONS,
} from './request-timeout';

export type SoupParams = Params;

export type SoupBody = Omit<PostSoupRequest, keyof SoupParams>;

export type SoupItemsQueryFilters = EntityFilters;

export type SoupItemsQueryArgs = {
  params: SoupParams;
  body: SoupBody;
};

export type SoupAstParams = Params;

export type SoupAstBody = ApiEntityFilterAst & PostSoupAstRequestAllOf;

export type SoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
  groupBy?: GroupByField;
  transport?: 'rest' | 'graphql';
};

export type SoupApiItemFilter = (item: SoupApiItem) => boolean;

interface SoupItemsQueryOptions {
  enabled?: boolean;
  staleTime?: StaleTime;
  meta?: {
    groupBy?: GroupByField;
    groupKey?: string;
    itemFilter?: (item: SoupApiItem) => boolean;
  };
  showSupportedForeignEntities?: boolean;
  /** Resets view-owned GraphQL state before a mutation-driven network refresh. */
  onBeforeGraphqlRefresh?: () => void;
}

/**
 * Cached page for `useSoupAstItemsQuery`. Discriminated by `kind`:
 * - `grouped`: items pool keyed by id, `groups[].itemIds` describes order.
 *   Parent never paginates when grouped — per-group queries handle load-more.
 * - `flat`: items array; standard infinite-query pagination.
 */
export type SoupAstItemsPage = SoupAstItemsGroupedPage | SoupAstItemsFlatPage;

export type SoupAstItemsGroupedPage = {
  kind: 'grouped';
  items: Record<string, SoupApiItem>;
  groups: GroupMeta[];
  nextCursor: null;
};

export type SoupAstItemsFlatPage = {
  kind: 'flat';
  items: SoupApiItem[];
  nextCursor: string | null;
};

export type SoupAstItemsData = {
  entities: EntityData[];
  groups: GroupMeta[] | undefined;
  /** Raw API item pool. Only present when query is grouped. */
  itemsById?: SoupAstItemsGroupedPage['items'];
};

export const useSoupItemsQuery = (
  args: Accessor<SoupItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
) => {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  const itemFilter: SoupApiItemFilter = (item: SoupApiItem) => {
    const body = args().body;
    if (!body) return true;
    return filterSoupItemByRequestBody(item, body);
  };

  return useInfiniteQuery(() => ({
    queryKey: soupKeys.items(args()).queryKey,
    queryFn: async (ctx) => {
      const { params, body } = args();

      return throwOnErr(
        async () =>
          await storageServiceClient.getSoupItems({
            params: { cursor: ctx.pageParam },
            body: {
              ...body,
              ...params,
            },
          })
      );
    },
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => {
      return lastPage.next_cursor;
    },
    select: (data) => {
      return data.pages.flatMap((page) => {
        return mapSoupPageToEntityList(page, {
          instructionsIdQuery,
          showSupportedForeignEntities:
            options?.().showSupportedForeignEntities,
        });
      });
    },
    enabled: options?.().enabled,
    staleTime: options?.().staleTime,
    placeholderData: (p) => p,
    meta: { itemFilter, normalize: true },
  }));
};

/** REST implementation kept private behind {@link useSoupAstItemsQuery}. */
const useRestSoupAstItemsQuery = (
  args: Accessor<SoupAstItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
) => {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  return useInfiniteQuery(() => {
    const { params, body, groupBy, transport } = args();

    return {
      queryKey: soupKeys.astItems({ params, body, groupBy, transport })
        .queryKey,
      queryFn: async (ctx): Promise<SoupAstItemsPage> => {
        const signal = createSoupRequestSignal(ctx.signal);

        if (groupBy) {
          const sort_method = groupedSortMethod(params.sort_method);

          const fetchRest = async () => {
            const response = await throwOnErr(
              async () =>
                await storageServiceClient.getGroupedSoupAstItems({
                  params: {
                    group_by: serializeGroupByField(groupBy),
                    per_group_limit: params.limit,
                    sort_method,
                  },
                  body,
                  signal,
                })
            );

            return {
              items: response.items,
              groups: response.groups.map(parseGroupMeta),
            };
          };

          const response = await fetchRest();

          return {
            kind: 'grouped',
            items: response.items,
            groups: response.groups,
            nextCursor: null,
          };
        }

        const fetchRest = () =>
          throwOnErr(
            async () =>
              await storageServiceClient.getSoupAstItems({
                params: {
                  cursor: ctx.pageParam,
                },
                body: {
                  ...body,
                  ...params,
                },
                signal,
              })
          );

        const response = await fetchRest();

        return {
          kind: 'flat',
          items: response.items,
          nextCursor: response.next_cursor ?? null,
        };
      },
      initialPageParam: null as string | null,
      getNextPageParam: (lastPage): string | null => {
        if (lastPage.kind === 'grouped') return null;
        return lastPage.nextCursor;
      },
      select: (data): SoupAstItemsData => {
        const firstPage = data.pages[0];

        if (firstPage?.kind === 'grouped') {
          const groups = firstPage.groups
            .slice()
            .sort(makeGroupComparator(groupBy));

          const itemsById = firstPage.items;
          const entities: EntityData[] = [];

          for (const g of groups) {
            for (const id of g.itemIds) {
              const item = itemsById[id];

              let displayable = false;

              if (item.tag === 'foreignEntity') {
                displayable =
                  options?.().showSupportedForeignEntities === true &&
                  item.data.foreignEntitySource === 'github_pull_request';
              } else {
                displayable =
                  item && !isInstructionsMdDoc(item, instructionsIdQuery);
              }
              if (displayable && isDisplayableSoupItem(item)) {
                const mapped = mapApiSoupItemToEntity(item);
                entities.push(mapped);
              }
            }
          }

          return { entities, groups, itemsById };
        }

        const entities = data.pages.flatMap((page) => {
          if (page.kind !== 'flat') return [];

          return mapSoupPageToEntityList(
            { items: page.items, next_cursor: null },
            {
              instructionsIdQuery,
              showSupportedForeignEntities:
                options?.().showSupportedForeignEntities,
            }
          );
        });

        return { entities, groups: undefined };
      },
      enabled: options?.().enabled,
      // Do not spin through background retries while the explicit load-error
      // state is visible. NWPathMonitor lets TanStack pause an offline query
      // and resume it automatically when the path becomes available again.
      ...SOUP_NETWORK_QUERY_OPTIONS,
      // A timed-out native request should reach the view's load-error state.
      // Retry remains available explicitly from that state.
      staleTime: options?.().staleTime,
      placeholderData: (prev, prevQuery) => {
        // Keep the previous rows on screen while params/filters change, but
        // not across a grouping switch — the old groups would render under
        // the new grouping (e.g. status groups while assignee groups load).
        const prevGroupBy = (
          prevQuery?.meta as SoupItemsQueryOptions['meta'] | undefined
        )?.groupBy;

        if (JSON.stringify(prevGroupBy) !== JSON.stringify(groupBy)) {
          return undefined;
        }

        return prev;
      },
      meta: {
        ...options?.().meta,
        groupBy,
        normalize: true,
      },
    };
  });
};

/** Transport selected by the Soup AST query facade. */
export type SoupAstItemsQueryTransport = 'rest' | 'graphql';

/** Stable query surface shared by the REST and urql-solid implementations. */
export type SoupAstItemsQuery = {
  readonly data: SoupAstItemsData | undefined;
  readonly error: Error | null;
  readonly isLoading: boolean;
  readonly isFetching: boolean;
  readonly isPlaceholderData: boolean;
  readonly isFetchingNextPage: boolean;
  readonly isEnabled: boolean;
  readonly hasNextPage: boolean;
  readonly transport: SoupAstItemsQueryTransport;
  fetchNextPage(): Promise<void>;
  refetch(): Promise<void>;
  /** Discards continuation pages while retaining the initial page. */
  resetToInitialPage(): void;
  /** Forces the selected transport to refetch from the network. */
  refresh(): Promise<void>;
};

/**
 * Queries Soup through urql-solid when the feature is enabled and the current
 * AST has a complete GraphQL translation. Unsupported requests retain the REST
 * behavior. Explicit `rest` and `graphql` transport values remain available
 * for rollout controls; forced GraphQL still falls back safely when unsupported.
 */
export function useSoupAstItemsQuery(
  args: Accessor<SoupAstItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
): SoupAstItemsQuery {
  const graphqlSoupFlag = useFeatureFlag(ENABLE_GRAPHQL_SOUP_FLAG, {
    enabledOverride: ENABLE_GRAPHQL_SOUP_OVERRIDE,
  });

  const queryEnabled = () => options?.().enabled !== false;
  const graphqlRequested = () => {
    const requestedTransport = args().transport;
    if (requestedTransport === 'rest') return false;
    if (requestedTransport === 'graphql') return true;
    return graphqlSoupFlag().enabled;
  };

  const graphqlFlatQuery = createGraphqlSoupAstItemsQuery(
    () => ({ params: args().params, body: args().body }),
    () => ({
      enabled:
        graphqlRequested() && queryEnabled() && args().groupBy === undefined,
      showSupportedForeignEntities: options?.().showSupportedForeignEntities,
    })
  );
  const graphqlGroupedQuery = createGraphqlGroupedSoupAstItemsQuery(
    () => ({
      params: args().params,
      body: args().body,
      groupBy: args().groupBy,
    }),
    () => ({
      enabled:
        graphqlRequested() && queryEnabled() && args().groupBy !== undefined,
      showSupportedForeignEntities: options?.().showSupportedForeignEntities,
    })
  );

  const activeGraphqlQuery = () =>
    args().groupBy === undefined ? graphqlFlatQuery : graphqlGroupedQuery;
  const usesGraphql = () =>
    graphqlRequested() && activeGraphqlQuery().isSupported();

  const restQuery = useRestSoupAstItemsQuery(args, () => {
    const currentOptions = options?.();
    return {
      ...currentOptions,
      enabled: queryEnabled() && !usesGraphql(),
    };
  });

  onCleanup(
    registerActiveGraphqlSoupQuery({
      isEnabled: () => usesGraphql() && activeGraphqlQuery().isEnabled(),
      refresh: async () => {
        activeGraphqlQuery().resetToInitialPage();
        options?.().onBeforeGraphqlRefresh?.();
        await activeGraphqlQuery().refresh();
      },
    })
  );

  const resetRestToInitialPage = () => {
    const { params, body, groupBy, transport } = args();
    queryClient.setQueryData<InfiniteData<SoupAstItemsPage, string | null>>(
      soupKeys.astItems({ params, body, groupBy, transport }).queryKey,
      (previous) => {
        if (!previous || previous.pages.length <= 1) return previous;
        return {
          ...previous,
          pages: previous.pages.slice(0, 1),
          pageParams: previous.pageParams.slice(0, 1),
        };
      }
    );
  };

  return {
    get data() {
      return usesGraphql() ? activeGraphqlQuery().data() : restQuery.data;
    },
    get error() {
      return usesGraphql()
        ? (activeGraphqlQuery().error() ?? null)
        : (restQuery.error ?? null);
    },
    get isLoading() {
      return usesGraphql()
        ? activeGraphqlQuery().isLoading()
        : restQuery.isLoading;
    },
    get isFetching() {
      return usesGraphql()
        ? activeGraphqlQuery().isFetching()
        : restQuery.isFetching;
    },
    get isPlaceholderData() {
      return usesGraphql()
        ? activeGraphqlQuery().isPlaceholderData()
        : restQuery.isPlaceholderData;
    },
    get isFetchingNextPage() {
      return usesGraphql()
        ? activeGraphqlQuery().isFetchingNextPage()
        : restQuery.isFetchingNextPage;
    },
    get isEnabled() {
      return usesGraphql()
        ? activeGraphqlQuery().isEnabled()
        : restQuery.isEnabled;
    },
    get hasNextPage() {
      return usesGraphql()
        ? activeGraphqlQuery().hasNextPage()
        : (restQuery.hasNextPage ?? false);
    },
    get transport() {
      return usesGraphql() ? 'graphql' : 'rest';
    },
    async fetchNextPage() {
      if (usesGraphql()) {
        await activeGraphqlQuery().fetchNextPage();
      } else {
        await restQuery.fetchNextPage();
      }
    },
    async refetch() {
      if (usesGraphql()) {
        await activeGraphqlQuery().refresh();
      } else {
        await restQuery.refetch();
      }
    },
    resetToInitialPage() {
      // Reset both urql bindings: a grouping switch can reactivate a flat page
      // chain (or vice versa) that was loaded before the current view.
      graphqlFlatQuery.resetToInitialPage();
      graphqlGroupedQuery.resetToInitialPage();
      if (!usesGraphql()) resetRestToInitialPage();
    },
    async refresh() {
      if (usesGraphql()) {
        await activeGraphqlQuery().refresh();
      } else {
        await restQuery.refetch({ throwOnError: true });
      }
    },
  };
}
