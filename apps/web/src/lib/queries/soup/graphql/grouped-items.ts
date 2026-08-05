/*
 * Reactive urql-backed grouped Soup parent query. The initial GroupSoup
 * operation remains subscribed so normalized property writes update grouped
 * rows and group membership without a TanStack invalidation round-trip.
 */

import { createUrqlQuery } from '@app/lib/urql-solid';
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
import { type Accessor, createComputed, createMemo, on } from 'solid-js';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from '../items';
import { mapSoupPageToEntityList } from '../transform-utils';
import { makeGraphqlGroupedSoupInput } from './ast';
import type { GraphqlSoupAstItemsQuery } from './items';

export type GraphqlGroupedSoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
  groupBy: GroupByField | undefined;
};

export type GraphqlGroupedSoupAstItemsQueryOptions = {
  enabled: boolean;
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
      requestPolicy: 'cache-and-network' as const,
      keepPreviousData: false,
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

  const error = (): CombinedError | undefined => query.error ?? undefined;
  createComputed(
    on(error, (queryError) => {
      if (queryError) {
        Telemetry.error(queryError, { graphqlOperation: 'GroupSoup' });
      }
    })
  );

  return {
    data: () => query.data,
    error,
    isSupported,
    isEnabled: () => query.isEnabled,
    isLoading: () => query.isLoading,
    isFetching: () => query.isFetching,
    isFetchingNextPage: () => false,
    hasNextPage: () => false,
    fetchNextPage: async () => undefined,
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
