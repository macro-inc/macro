/*
 * Reactive urql-backed grouped Soup parent query. The initial GroupSoup
 * operation remains subscribed so normalized property writes update grouped
 * rows and group membership without a TanStack invalidation round-trip.
 */

import {
  type CacheRevision,
  normalizedCacheResultMetadata,
} from '@app/lib/graphql-cache';
import { createBrowserOfflineSignal } from '@core/util/connectivity';
import { fireAndForget } from '@core/util/fireAndForget';
import { isTransientRequestError } from '@core/util/request-error';
import { Telemetry } from '@macro-inc/observability';
import type { GroupByField } from '@queries/soup/grouped/types';
import { GroupSoupDocument } from '@service-storage/graphql/generated/graphql';
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
import type { SoupAstBody, SoupAstParams } from '../items';
import { registerGraphqlSoupRevalidations } from './active-queries';
import { makeGraphqlGroupedSoupInput } from './ast';
import { createGroupedSoupLiveQuery } from './create-grouped-soup-live-query';
import { createGraphqlSoupDoneProjection } from './done-projection';
import { createGraphqlGroupedSoupProjection } from './grouped-projection';
import {
  createGraphqlSoupAstItemsQuery,
  type GraphqlSoupAstItemsQuery,
} from './items';
import { usePendingGraphqlSoupDeleteIds } from './optimistic-deletions';
import { usePendingGraphqlSoupDone } from './optimistic-done';

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

/** Creates the live urql parent query for a grouped Soup AST request. */
export function createGraphqlGroupedSoupAstItemsQuery(
  args: Accessor<GraphqlGroupedSoupAstItemsQueryArgs>,
  options: Accessor<GraphqlGroupedSoupAstItemsQueryOptions>
): GraphqlSoupAstItemsQuery {
  const pendingDeleteIds = usePendingGraphqlSoupDeleteIds();
  const pendingDone = usePendingGraphqlSoupDone();
  const projectDone = createGraphqlSoupDoneProjection();
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
  const inputKey = createMemo(() => JSON.stringify(input()));

  const grouped = createGroupedSoupLiveQuery(
    input,
    () => {
      const queryInput = input();
      return {
        ...options(),
        onInitialResult: (result) => {
          const metadata = normalizedCacheResultMetadata(result);
          if (metadata?.source !== 'live-network') return;
          const version = ++networkResultVersion;
          setNetworkRevision(undefined);
          if (result.error || result.data == null || result.hasNext) return;
          fireAndForget(
            acknowledgeNetworkResult(
              metadata.persistence ?? Promise.resolve(metadata.revision),
              queryInput,
              version
            ),
            'soup-grouped-items'
          );
        },
      };
    },
    now
  );
  const query = grouped.query;

  const projected = createGraphqlGroupedSoupProjection(
    grouped.data,
    () => args().groupBy,
    () => ({
      showSupportedForeignEntities: options().showSupportedForeignEntities,
    })
  );

  // Missing data during a refetch does not itself switch identities. A new
  // viewer's first response still invalidates every old restoration snapshot.
  const viewerId = createMemo<string | undefined>(
    (previous) => query.data?.data.user.id ?? previous,
    undefined
  );

  onCleanup(
    registerGraphqlSoupRevalidations(() => {
      const queryInput = input();
      return query.isEnabled && queryInput
        ? [{ document: GroupSoupDocument, variables: { input: queryInput } }]
        : [];
    })
  );

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
  const error = (): CombinedError | undefined => {
    const error = query.error;
    // A failed refresh must not hide usable current-query data, including an
    // empty page. Retained data from other filters is not an offline fallback.
    // Server/GraphQL errors and failures without cached data still surface.
    if (
      error &&
      isTransientRequestError(error) &&
      !error.response &&
      options().enabled &&
      isSupported() &&
      (cachedMail() !== undefined ||
        (query.data?.inputKey === inputKey() && query.data?.data !== undefined))
    ) {
      return undefined;
    }
    return error ?? undefined;
  };
  createComputed(
    on(error, (queryError) => {
      if (queryError) {
        Telemetry.error(queryError, { graphqlOperation: 'GroupSoup' });
      }
    })
  );

  return {
    groupedPaging: grouped.paging,
    data: createMemo(() =>
      projectDone(
        JSON.stringify([input(), viewerId()]),
        cachedMail() ?? projected(),
        pendingDone(),
        excludesDone(),
        pendingDeleteIds()
      )
    ),
    error,
    isSupported,
    isEnabled: () => query.isEnabled,
    isLoading: () => !cachedMail() && query.isLoading,
    isFetching: () => query.isFetching,
    isFetchingNextPage: () => !!cachedMail() && local.isFetchingNextPage(),
    isFetchNextPageError: () => !!cachedMail() && local.isFetchNextPageError(),
    isPlaceholderData: () => false,
    hasNextPage: () => !!cachedMail() && local.hasNextPage(),
    fetchNextPage: async () => {
      if (cachedMail()) await local.fetchNextPage();
    },
    resetToInitialPage: grouped.paging.resetToInitialPage,
    refresh: async () => {
      if (input() === undefined) return;
      await grouped.refresh();
    },
  };
}
