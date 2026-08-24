/*
 * Reactive urql-backed Soup items. Every loaded page remains subscribed to
 * its normalized GraphQL cache operation so cache writes update the list
 * directly. The public REST/GraphQL facade lives in ../items.ts.
 */

import { readRecordsByKeys, selectRecords } from '@app/lib/graphql-cache';
import { createUrqlInfiniteQuery } from '@app/lib/urql-solid';
import { Telemetry } from '@macro-inc/observability';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import {
  SoupDocument,
  SoupItemFieldsFragmentDoc,
  type SoupQuery,
  type SoupQueryVariables,
} from '@service-storage/graphql/generated/graphql';
import type { GraphqlSoupInput } from '@service-storage/graphql-soup';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
  mapGraphqlSoupItem,
  mapGraphqlSoupPage,
} from '@service-storage/graphql-soup';
import type { CombinedError } from '@urql/core';
import {
  type Accessor,
  createComputed,
  createEffect,
  createMemo,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from '../items';
import { mapSoupPageToEntityList } from '../transform-utils';
import { makeGraphqlSoupInput } from './ast';

export type GraphqlSoupAstItemsQueryArgs = {
  params: SoupAstParams;
  body: SoupAstBody;
};

export type GraphqlSoupAstItemsQueryOptions = {
  enabled: boolean;
  showSupportedForeignEntities?: boolean;
};

export type GraphqlSoupAstItemsQuery = {
  data: Accessor<SoupAstItemsData | undefined>;
  /** Latest GraphQL transport or application error. */
  error: Accessor<CombinedError | undefined>;
  /** False when the filter AST has no GraphQL translation. */
  isSupported: Accessor<boolean>;
  isEnabled: Accessor<boolean>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  isPlaceholderData: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  fetchNextPage: () => Promise<void>;
  /** Discards loaded continuation pages while retaining the initial page. */
  resetToInitialPage: () => void;
  /** Refetches the currently loaded page chain from the network. */
  refresh: () => Promise<void>;
};

/** Creates the live urql query for a flat Soup AST request. */
export function createGraphqlSoupAstItemsQuery(
  args: Accessor<GraphqlSoupAstItemsQueryArgs>,
  options: Accessor<GraphqlSoupAstItemsQueryOptions>
): GraphqlSoupAstItemsQuery {
  const instructionsIdQuery = useInstructionsMdIdQuery();

  const inputForCursor = (
    cursor: string | null
  ): GraphqlSoupInput | undefined => {
    const { params, body } = args();
    try {
      return makeGraphqlSoupInput({ params, body, cursor });
    } catch {
      // Unsupported GraphQL Soup AST — the public facade falls back to REST.
      return undefined;
    }
  };

  const firstPageInput = createMemo(() => inputForCursor(null));
  const isSupported = () => firstPageInput() !== undefined;
  const [localPlaceholder, setLocalPlaceholder] = createSignal<
    { data: SoupAstItemsData; optimistic: boolean } | undefined
  >();
  const [cacheRevision, setCacheRevision] = createSignal(0);
  const soupItemSelection = selectRecords(SoupItemFieldsFragmentDoc);
  let localRequest = 0;

  createEffect(() => {
    const host = getGraphqlSoupCacheHost();
    if (!host) return;
    const unsubscribe = host.onCacheChanged(() => {
      setCacheRevision((revision) => revision + 1);
    });
    onCleanup(unsubscribe);
  });

  createEffect(() => {
    cacheRevision();
    const requestId = ++localRequest;
    setLocalPlaceholder(undefined);
    const input = firstPageInput();
    const queryOptions = options();
    const host = getGraphqlSoupCacheHost();
    if (!queryOptions.enabled || !input || !host || !('initial' in input))
      return;
    const initial = input.initial;
    if (!initial) return;
    const filters = initial.filters ?? {};
    const sortMethod = initial.sortMethod;
    if (!sortMethod || sortMethod === 'VIEWED_AT') return;
    const sortDirection = initial.sortDirection ?? 'DESC';
    const limit = initial.limit ?? 20;

    void host
      .entityFilter({ filters, sortMethod, sortDirection, limit })
      .then(async (result) => {
        if (result.kind !== 'complete' || requestId !== localRequest) return;
        const selected = await readRecordsByKeys(
          host,
          soupItemSelection,
          result.keys
        );
        if (
          requestId !== localRequest ||
          selected.length !== result.keys.length
        )
          return;
        const items = selected.flatMap(({ record }) => {
          const item = mapGraphqlSoupItem(record);
          return item ? [item] : [];
        });
        if (items.length !== result.keys.length) return;
        setLocalPlaceholder({
          optimistic: result.optimistic,
          data: {
            entities: mapSoupPageToEntityList(
              { items, next_cursor: undefined },
              {
                instructionsIdQuery,
                showSupportedForeignEntities:
                  queryOptions.showSupportedForeignEntities,
              }
            ),
            groups: undefined,
          },
        });
      })
      .catch(() => {
        // Unsupported, incomplete, validation, and storage failures all use
        // the already-running authoritative network request.
      });
  });

  const query = createUrqlInfiniteQuery<
    SoupQuery,
    SoupQueryVariables,
    string | null,
    SoupAstItemsData
  >(() => {
    const firstInput = firstPageInput();
    const queryOptions = options();
    const showSupportedForeignEntities =
      queryOptions.showSupportedForeignEntities;

    return {
      query: SoupDocument,
      client: getGraphqlSoupClient(),
      initialPageParam: null,
      variables: (cursor) => {
        const input = inputForCursor(cursor);
        if (!input) {
          throw new Error('GraphQL Soup input became unsupported');
        }
        return { input };
      },
      getNextPageParam: (lastPage) =>
        lastPage.user.soup.nextCursor ?? undefined,
      enabled: queryOptions.enabled && firstInput !== undefined,
      requestPolicy: 'cache-and-network',
      keepPreviousData: false,
      select: ({ pages }) => ({
        entities: pages.flatMap((page) =>
          mapSoupPageToEntityList(mapGraphqlSoupPage(page), {
            instructionsIdQuery,
            showSupportedForeignEntities,
          })
        ),
        groups: undefined,
      }),
    };
  });

  const error = (): CombinedError | undefined => query.error ?? undefined;
  createComputed(
    on(error, (queryError) => {
      if (queryError) {
        Telemetry.error(queryError, { graphqlOperation: 'Soup' });
      }
    })
  );

  return {
    data: () => {
      const local = localPlaceholder();
      return local?.optimistic ? local.data : (query.data ?? local?.data);
    },
    error,
    isSupported,
    isEnabled: () => query.isEnabled,
    isLoading: () => query.isLoading && localPlaceholder() === undefined,
    isFetching: () => query.isFetching,
    isFetchingNextPage: () => query.isFetchingNextPage,
    isPlaceholderData: () => {
      const local = localPlaceholder();
      return (
        local !== undefined && (query.data === undefined || local.optimistic)
      );
    },
    hasNextPage: () => query.hasNextPage,
    fetchNextPage: async () => {
      await query.fetchNextPage();
    },
    resetToInitialPage: query.resetToInitialPage,
    refresh: async () => {
      if (firstPageInput() === undefined) return;
      await query.refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
    },
  };
}
