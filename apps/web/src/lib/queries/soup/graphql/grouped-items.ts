/*
 * Reactive urql-backed grouped Soup parent query. The initial GroupSoup
 * operation remains subscribed so normalized property writes update grouped
 * rows and group membership without a TanStack invalidation round-trip.
 */

import {
  type CacheRevision,
  normalizedCacheResultMetadata,
} from '@app/lib/graphql-cache';
import { createUrqlQuery } from '@app/lib/urql-solid';
import { createBrowserOfflineSignal } from '@core/util/connectivity';
import { Telemetry } from '@macro-inc/observability';
import {
  makeGroupComparator,
  resolveGroupMetaForKey,
} from '@queries/soup/grouped/api';
import type { GroupByField, GroupMeta } from '@queries/soup/grouped/types';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import {
  GroupSoupDocument,
  type GroupSoupQuery,
  type GroupSoupQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupClient,
  mapGraphqlGroupedSoupPage,
} from '@service-storage/graphql-soup';
import type { CombinedError } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { soupQueryExcludesDone } from '../excludes-done';
import { groupCachedMailByDate } from '../grouped/mail-date-groups';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from '../items';
import { mapSoupPageToEntityList } from '../transform-utils';
import { registerGraphqlSoupRevalidations } from './active-queries';
import { makeGraphqlGroupedSoupInput } from './ast';
import {
  createGraphqlSoupAstItemsQuery,
  type GraphqlSoupAstItemsQuery,
} from './items';
import {
  usePendingGraphqlSoupDeleteIds,
  withoutPendingGraphqlSoupDeletes,
} from './optimistic-deletions';
import {
  usePendingGraphqlSoupDone,
  withPendingDoneIds,
} from './optimistic-done';

export type GraphqlGroupedSoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
  groupBy: GroupByField | undefined;
};

export type GraphqlGroupedSoupAstItemsQueryOptions = {
  enabled: boolean;
  networkPaused?: boolean;
  keepPreviousData?: boolean;
  showSupportedForeignEntities?: boolean;
};

function mapGraphqlGroupedSoupData(
  data: GroupSoupQuery,
  groupBy: GroupByField,
  options: Parameters<typeof mapSoupPageToEntityList>[1]
): SoupAstItemsData {
  const page = mapGraphqlGroupedSoupPage(data);
  const groups = page.groups
    .map((group): GroupMeta => {
      const firstItem = page.items[group.itemIds[0] ?? ''];
      const resolved = resolveGroupMetaForKey(groupBy, group.key, firstItem);
      return {
        key: group.key,
        label: resolved?.label ?? group.key,
        displayOrder: resolved?.displayOrder ?? null,
        totalCount: group.totalCount,
        itemIds: group.itemIds,
        nextCursor: group.nextCursor,
      };
    })
    .sort(makeGroupComparator(groupBy));

  const items = groups.flatMap((group) =>
    group.itemIds.flatMap((id) => {
      const item = page.items[id];
      return item ? [item] : [];
    })
  );

  return {
    entities: mapSoupPageToEntityList(
      { items, next_cursor: undefined },
      options
    ),
    groups,
    itemsById: page.items,
  };
}

/** Creates the live urql parent query for a grouped Soup AST request. */
export function createGraphqlGroupedSoupAstItemsQuery(
  args: Accessor<GraphqlGroupedSoupAstItemsQueryArgs>,
  options: Accessor<GraphqlGroupedSoupAstItemsQueryOptions>
): GraphqlSoupAstItemsQuery {
  const instructionsIdQuery = useInstructionsMdIdQuery();
  const pendingDeleteIds = usePendingGraphqlSoupDeleteIds();
  const pendingDone = usePendingGraphqlSoupDone();
  const excludesDone = createMemo(() => soupQueryExcludesDone([args().body]));
  const [now, setNow] = createSignal(new Date());
  const dateTimer = setInterval(() => setNow(new Date()), 60_000);
  onCleanup(() => clearInterval(dateTimer));
  const [networkRevision, setNetworkRevision] = createSignal<CacheRevision>();
  const [networkInput, setNetworkInput] = createSignal<unknown>();
  const offline = createBrowserOfflineSignal();
  let networkResultVersion = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
  async function acknowledgeNetworkResult(
    persistence: Promise<CacheRevision | undefined>,
    queryInput: unknown,
    version: number
  ) {
    try {
      const revision = await persistence;
      if (
        disposed ||
        version !== networkResultVersion ||
        queryInput !== input()
      )
        return;
      setNetworkRevision(revision);
      setNetworkInput(queryInput);
    } catch {
      // Keep the local Mail fallback when the network result could not be cached.
    }
  }
  const local = createGraphqlSoupAstItemsQuery(
    () => ({ params: args().params, body: args().body }),
    () => ({
      ...options(),
      localOnly: true,
      enabled:
        options().enabled &&
        args().groupBy?.type === 'date' &&
        args().body.emailView !== undefined,
    })
  );

  const input = createMemo(() => {
    const { params, body, groupBy } = args();
    if (!groupBy) return;
    try {
      return makeGraphqlGroupedSoupInput({ params, body, groupBy });
    } catch {
      // Unsupported GraphQL Soup AST — the public facade falls back to REST.
      return undefined;
    }
  });
  const isSupported = () => input() !== undefined;

  const query = createUrqlQuery<
    GroupSoupQuery,
    GroupSoupQueryVariables,
    SoupAstItemsData
  >(() => {
    const queryOptions = options();
    const groupBy = args().groupBy;
    const queryInput = input();

    const common = {
      query: GroupSoupDocument,
      client: getGraphqlSoupClient(),
      requestPolicy: queryOptions.networkPaused
        ? ('cache-only' as const)
        : ('cache-and-network' as const),
      keepPreviousData: queryOptions.keepPreviousData ?? false,
      onResult: (
        result: import('@urql/core').OperationResult<
          GroupSoupQuery,
          GroupSoupQueryVariables
        >
      ) => {
        const metadata = normalizedCacheResultMetadata(result);
        if (metadata?.source !== 'live-network') return;
        const version = ++networkResultVersion;
        setNetworkRevision(undefined);
        if (result.error || result.data == null || result.hasNext) return;
        void acknowledgeNetworkResult(
          metadata.persistence ?? Promise.resolve(metadata.revision),
          queryInput,
          version
        );
      },
      select: (data: GroupSoupQuery) =>
        mapGraphqlGroupedSoupData(data, groupBy!, {
          instructionsIdQuery,
          showSupportedForeignEntities:
            queryOptions.showSupportedForeignEntities,
        }),
    };

    if (!queryOptions.enabled || !groupBy || queryInput === undefined) {
      return { ...common, enabled: false as const };
    }

    return {
      ...common,
      variables: { input: queryInput },
      enabled: true,
    };
  });

  onCleanup(
    registerGraphqlSoupRevalidations(() => {
      const queryInput = input();
      return query.isEnabled && queryInput
        ? [{ document: GroupSoupDocument, variables: { input: queryInput } }]
        : [];
    })
  );

  const error = (): CombinedError | undefined => query.error ?? undefined;
  const cachedMail = createMemo(() => {
    const data = local.data();
    if (
      !options().enabled ||
      args().groupBy?.type !== 'date' ||
      !data?.cachedMail
    )
      return;
    if (
      !offline() &&
      !local.localOptimistic?.() &&
      networkRevision() !== undefined &&
      networkInput() === input() &&
      networkRevision() === local.localRevision?.()
    )
      return;
    return groupCachedMailByDate(data, now());
  });
  createComputed(
    on(error, (queryError) => {
      if (queryError) {
        Telemetry.error(queryError, { graphqlOperation: 'GroupSoup' });
      }
    })
  );

  return {
    data: () => {
      const data = cachedMail() ?? query.data;
      return withoutPendingGraphqlSoupDeletes(
        data,
        excludesDone()
          ? withPendingDoneIds(
              pendingDeleteIds(),
              data?.entities ?? [],
              pendingDone()
            )
          : pendingDeleteIds()
      );
    },
    error,
    isSupported,
    isEnabled: () => query.isEnabled,
    isLoading: () => !cachedMail() && query.isLoading,
    isFetching: () => query.isFetching,
    isFetchingNextPage: () => !!cachedMail() && local.isFetchingNextPage(),
    isPlaceholderData: () => false,
    hasNextPage: () => !!cachedMail() && local.hasNextPage(),
    fetchNextPage: async () => {
      if (cachedMail()) await local.fetchNextPage();
    },
    resetToInitialPage: () => undefined,
    refresh: async () => {
      if (input() === undefined) return;
      await query.refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
    },
  };
}
