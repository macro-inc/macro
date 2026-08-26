/*
 * Reactive urql-backed Soup items. Every loaded page remains subscribed to
 * its normalized GraphQL cache operation so cache writes update the list
 * directly. The public REST/GraphQL facade lives in ../items.ts.
 */

import {
  type CacheRevision,
  normalizedCacheResultMetadata,
  readRecordsByKeys,
  selectRecords,
} from '@app/lib/graphql-cache';
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
  batch,
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
  type LocalProjection = {
    revision: CacheRevision;
    data: SoupAstItemsData;
    optimistic: boolean;
  };
  const [currentCacheRevision, setCurrentCacheRevision] = createSignal<
    CacheRevision | undefined
  >();
  const [networkAuthorityRevision, setNetworkAuthorityRevision] = createSignal<
    CacheRevision | undefined
  >();
  const [localProjection, setLocalProjection] = createSignal<
    LocalProjection | undefined
  >();
  const soupItemSelection = selectRecords(SoupItemFieldsFragmentDoc);
  let localRequest = 0;
  let cacheGeneration = 0;
  let resetContinuationPages: (() => void) | undefined;
  let previousInitialInput: GraphqlSoupInput | undefined;
  let staleFallbackSpan: ReturnType<typeof Telemetry.span> | undefined;

  const recordAuthority = (source: 'network' | 'local' | 'stale-fallback') => {
    const span = Telemetry.span('graphql_cache.soup_authority');
    span.setAttr('authority.source', source);
    span.end();
  };
  const finishStaleFallback = (source: 'network' | 'local') => {
    staleFallbackSpan?.setAttr('authority.resumed_by', source);
    staleFallbackSpan?.end();
    staleFallbackSpan = undefined;
  };

  createEffect(() => {
    const host = getGraphqlSoupCacheHost();
    if (!host) return;
    cacheGeneration += 1;
    const invalidateGeneration = () => {
      localRequest += 1;
      setCurrentCacheRevision(undefined);
      setNetworkAuthorityRevision(undefined);
      setLocalProjection(undefined);
    };
    const observeCurrentRevision = () => {
      const observedGeneration = cacheGeneration;
      void host
        .currentRevision()
        .then((revision) => {
          if (
            observedGeneration === cacheGeneration &&
            currentCacheRevision() === undefined
          ) {
            setCurrentCacheRevision(revision);
          }
        })
        .catch(() => undefined);
    };
    const unsubscribeChanges = host.onCacheChanged((revision) => {
      if (
        networkAuthorityRevision() !== undefined &&
        networkAuthorityRevision() !== revision &&
        staleFallbackSpan === undefined
      ) {
        staleFallbackSpan = Telemetry.span('graphql_cache.soup_stale_fallback');
        recordAuthority('stale-fallback');
      }
      setCurrentCacheRevision(revision);
    });
    const unsubscribeGeneration = host.onCacheGenerationChanged(() => {
      const span = Telemetry.span('graphql_cache.engine_generation_changed');
      span.end();
      cacheGeneration += 1;
      invalidateGeneration();
      observeCurrentRevision();
    });
    observeCurrentRevision();
    onCleanup(() => {
      staleFallbackSpan?.end();
      staleFallbackSpan = undefined;
      cacheGeneration += 1;
      unsubscribeChanges();
      unsubscribeGeneration();
    });
  });

  createEffect(() => {
    const revision = currentCacheRevision();
    const input = firstPageInput();
    const queryOptions = options();
    const host = getGraphqlSoupCacheHost();
    const requestId = ++localRequest;
    if (input !== previousInitialInput) {
      previousInitialInput = input;
      setLocalProjection(undefined);
    }
    if (
      revision === undefined ||
      networkAuthorityRevision() === revision ||
      !queryOptions.enabled ||
      !input ||
      !host ||
      !('initial' in input)
    ) {
      return;
    }
    const initial = input.initial;
    if (!initial) return;
    const filters = initial.filters ?? {};
    const sortMethod = initial.sortMethod;
    if (!sortMethod || sortMethod === 'VIEWED_AT') return;
    const sortDirection = initial.sortDirection ?? 'DESC';
    const limit = initial.limit ?? 20;

    void (async () => {
      const span = Telemetry.span('graphql_cache.soup_local_evaluation');
      let expectedRevision = revision;
      let retryCount = 0;
      let discarded = false;
      let outcome: 'success' | 'incomplete' | 'error' = 'incomplete';
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          const result = await host.entityFilter({
            filters,
            sortMethod,
            sortDirection,
            limit,
          });
          if (result.kind !== 'complete') return;
          if (requestId !== localRequest) {
            discarded = true;
            return;
          }
          const selected = await readRecordsByKeys(
            host,
            soupItemSelection,
            result.keys
          );
          const latestRevision = await host.currentRevision();
          if (requestId !== localRequest) {
            discarded = true;
            return;
          }
          if (
            result.revision !== selected.revision ||
            result.revision !== latestRevision ||
            result.revision !== expectedRevision
          ) {
            discarded = true;
            retryCount += 1;
            expectedRevision = latestRevision;
            setCurrentCacheRevision(latestRevision);
            continue;
          }
          if (selected.records.length !== result.keys.length) return;
          const items = selected.records.flatMap(({ record }) => {
            const item = mapGraphqlSoupItem(record);
            return item ? [item] : [];
          });
          if (items.length !== result.keys.length) return;
          setLocalProjection({
            revision: latestRevision,
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
          outcome = 'success';
          recordAuthority('local');
          finishStaleFallback('local');
          resetContinuationPages?.();
          return;
        }
      } catch {
        outcome = 'error';
        // Unsupported, incomplete, validation, and storage failures retain
        // the stale network/normalized-cache fallback already on screen.
      } finally {
        span.setAttr('evaluation.outcome', outcome);
        span.setAttr('evaluation.retry_count', retryCount);
        span.setAttr('evaluation.discarded', discarded);
        span.end();
      }
    })();
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
      onResult: (result, page) => {
        if (page.pageIndex !== 0) return;
        const metadata = normalizedCacheResultMetadata(result);
        if (metadata?.source !== 'live-network' || !metadata.revision) return;
        batch(() => {
          setCurrentCacheRevision(metadata.revision);
          setNetworkAuthorityRevision(metadata.revision);
          setLocalProjection(undefined);
        });
        recordAuthority('network');
        finishStaleFallback('network');
      },
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

  resetContinuationPages = query.resetToInitialPage;

  const authoritativeLocalProjection = (): LocalProjection | undefined => {
    const local = localProjection();
    const revision = currentCacheRevision();
    return local?.revision === revision ? local : undefined;
  };
  const networkIsAuthoritative = (): boolean =>
    networkAuthorityRevision() !== undefined &&
    networkAuthorityRevision() === currentCacheRevision();

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
      if (networkIsAuthoritative()) return query.data;
      const local = authoritativeLocalProjection();
      return local?.data ?? query.data ?? localProjection()?.data;
    },
    error,
    isSupported,
    isEnabled: () => query.isEnabled,
    isLoading: () =>
      query.isLoading && authoritativeLocalProjection() === undefined,
    isFetching: () => query.isFetching,
    isFetchingNextPage: () => query.isFetchingNextPage,
    isPlaceholderData: () =>
      !networkIsAuthoritative() && authoritativeLocalProjection() !== undefined,
    hasNextPage: () => query.hasNextPage,
    fetchNextPage: async () => {
      // Local predicate pagination is not revision-safe yet. Return to the
      // stale server page chain before requesting its continuation cursor.
      setLocalProjection(undefined);
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
