import { filterSoupItemByRequestBody } from '@app/features/next-soup/filters/query-filters';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { enableGraphqlSoup } from '@core/constant/featureFlags';
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
  infiniteQueryOptions,
  type StaleTime,
  useInfiniteQuery,
} from '@tanstack/solid-query';
import { type Accessor, onCleanup } from 'solid-js';
import { queryClient } from '../client';
import { registerActiveGraphqlSoupQuery } from './graphql/active-queries';
import { createGraphqlGroupedSoupAstItemsQuery } from './graphql/grouped-items';
import { createGraphqlSoupAstItemsQuery } from './graphql/items';
import { soupPageTimestamp } from './page-timestamp';
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
  /** Channel navigation reads bounded unread evidence, not notification history. */
  graphqlProjection?: 'channel-list';
  meta?: {
    groupBy?: GroupByField;
    groupKey?: string;
    itemFilter?: (item: SoupApiItem) => boolean;
    /** Gates optimistic cache inserts only — fetched rows never run through it. */
    insertFilter?: (item: SoupApiItem) => boolean;
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
  oldestFetchedTimestamp?: number;
};

export type SoupAstItemsData = {
  /** Local Mail results cover synchronized metadata, not the entire mailbox. */
  cachedMail?: boolean;
  entities: EntityData[];
  /** Descending page coverage, independent of optimistic/local row membership. */
  oldestFetchedTimestamp?: number;
  groups: GroupMeta[] | undefined;
  /** Raw API item pool. Only present when query is grouped. */
  itemsById?: SoupAstItemsGroupedPage['items'];
};

// Cached options outlive the view. Keep its accessors and query proxies out.
function soupItemsQueryOptions(
  args: SoupItemsQueryArgs,
  enabled: boolean | undefined,
  staleTime: StaleTime | undefined,
  instructionsId: string | null | undefined,
  showSupportedForeignEntities: boolean | undefined
) {
  const { params, body } = args;
  return infiniteQueryOptions({
    queryKey: soupKeys.items(args).queryKey,
    queryFn: (ctx) =>
      throwOnErr(() =>
        storageServiceClient.getSoupItems({
          params: { cursor: ctx.pageParam },
          body: { ...body, ...params },
        })
      ),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    select: (data) =>
      data.pages.flatMap((page) =>
        mapSoupPageToEntityList(page, {
          instructionsIdQuery: { isSuccess: true, data: instructionsId },
          showSupportedForeignEntities,
        })
      ),
    enabled,
    staleTime,
    placeholderData: (p) => p,
    meta: {
      itemFilter: (item: SoupApiItem) =>
        !body || filterSoupItemByRequestBody(item, body),
      normalize: true,
    },
  });
}

export const useSoupItemsQuery = (
  args: Accessor<SoupItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
) => {
  const instructionsIdQuery = useInstructionsMdIdQuery();
  return useInfiniteQuery(() =>
    soupItemsQueryOptions(
      args(),
      options?.().enabled,
      options?.().staleTime,
      instructionsIdQuery.isSuccess ? instructionsIdQuery.data : undefined,
      options?.().showSupportedForeignEntities
    )
  );
};

type RestSoupAstItemsMeta = SoupItemsQueryOptions['meta'];

async function fetchRestSoupAstItemsPage(
  { params, body, groupBy }: SoupAstItemsQueryArgs,
  cursor: string | null,
  requestSignal: AbortSignal
): Promise<SoupAstItemsPage> {
  const signal = createSoupRequestSignal(requestSignal);

  if (groupBy) {
    const sort_method = groupedSortMethod(params.sort_method);

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
      kind: 'grouped',
      items: response.items,
      groups: response.groups.map(parseGroupMeta),
      nextCursor: null,
    };
  }

  const response = await throwOnErr(
    async () =>
      await storageServiceClient.getSoupAstItems({
        params: { cursor },
        body: {
          ...body,
          ...params,
        },
        signal,
      })
  );

  return {
    kind: 'flat',
    items: response.items,
    nextCursor: response.next_cursor ?? null,
    oldestFetchedTimestamp: soupPageTimestamp(
      response.items.map(mapApiSoupItemToEntity),
      params.sort_method
    ),
  };
}

function getNextRestSoupAstPageParam(
  lastPage: SoupAstItemsPage
): string | null {
  if (lastPage.kind === 'grouped') return null;
  return lastPage.nextCursor;
}

// Cached options outlive the view. Only plain snapshots enter here: no view
// accessors, option accessors, or query proxies.
function restSoupAstItemsQueryOptions(
  args: SoupAstItemsQueryArgs,
  enabled: boolean | undefined,
  staleTime: StaleTime | undefined,
  meta: RestSoupAstItemsMeta,
  instructionsId: string | null | undefined,
  showSupportedForeignEntities: boolean | undefined
) {
  const { params, body, groupBy, transport } = args;
  const instructionsIdQuery = { isSuccess: true, data: instructionsId };

  return infiniteQueryOptions({
    queryKey: soupKeys.astItems({ params, body, groupBy, transport }).queryKey,
    queryFn: (ctx) =>
      fetchRestSoupAstItemsPage(args, ctx.pageParam, ctx.signal),
    initialPageParam: null as string | null,
    getNextPageParam: getNextRestSoupAstPageParam,
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
                showSupportedForeignEntities === true &&
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
          { instructionsIdQuery, showSupportedForeignEntities }
        );
      });

      const pageTimestamps = data.pages.flatMap((page) =>
        page.kind === 'flat' && page.oldestFetchedTimestamp !== undefined
          ? [page.oldestFetchedTimestamp]
          : []
      );
      return {
        entities,
        groups: undefined,
        oldestFetchedTimestamp:
          pageTimestamps.length > 0 ? Math.min(...pageTimestamps) : undefined,
      };
    },
    enabled,
    // Do not spin through background retries while the explicit load-error
    // state is visible. NWPathMonitor lets TanStack pause an offline query
    // and resume it automatically when the path becomes available again.
    ...SOUP_NETWORK_QUERY_OPTIONS,
    // A timed-out native request should reach the view's load-error state.
    // Retry remains available explicitly from that state.
    staleTime,
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
      ...meta,
      groupBy,
      normalize: true,
    },
  });
}

/** REST implementation kept private behind {@link useSoupAstItemsQuery}. */
const useRestSoupAstItemsQuery = (
  args: Accessor<SoupAstItemsQueryArgs>,
  options?: Accessor<SoupItemsQueryOptions>
) => {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  return useInfiniteQuery(() =>
    restSoupAstItemsQueryOptions(
      args(),
      options?.().enabled,
      options?.().staleTime,
      options?.().meta,
      instructionsIdQuery.isSuccess ? instructionsIdQuery.data : undefined,
      options?.().showSupportedForeignEntities
    )
  );
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
  const graphqlSoupFlag = useFeatureFlag(enableGraphqlSoup);

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
      projection: options?.().graphqlProjection,
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
