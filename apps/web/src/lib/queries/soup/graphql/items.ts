/*
 * Reactive urql-backed Soup items. Every loaded page remains subscribed to
 * its normalized GraphQL cache operation. Supported flat queries reconcile
 * server membership with local evidence without replacing the server cursor
 * chain. The public REST/GraphQL facade lives in ../items.ts.
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
import type {
  GraphqlSoupInput,
  GraphqlSoupItem,
} from '@service-storage/graphql-soup';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
  graphqlSoupProjectionSupported,
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
import {
  materializeReconciledSoup,
  soupReconciliationBaseline,
} from './reconciliation';

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
  type ServerProjection = {
    data: SoupAstItemsData;
    records: GraphqlSoupItem[];
  };
  type LocalProjection = {
    revision: CacheRevision;
    data: SoupAstItemsData;
    baseline: readonly GraphqlSoupItem[];
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
  const [localEvaluationTrigger, setLocalEvaluationTrigger] = createSignal(0);
  const soupItemSelection = selectRecords(SoupItemFieldsFragmentDoc);
  let localRequest = 0;
  let localEvaluationRunning = false;
  let localEvaluationPending = false;
  let cacheGeneration = 0;
  const [baselineGeneration, setBaselineGeneration] = createSignal<number>();
  let previousInitialInput: GraphqlSoupInput | undefined;
  let networkAuthorityInput: GraphqlSoupInput | undefined;
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
      setBaselineGeneration(undefined);
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
    localEvaluationTrigger();
    const revision = currentCacheRevision();
    const input = firstPageInput();
    const queryOptions = options();
    const host = getGraphqlSoupCacheHost();
    const records = serverRecords();
    const requestId = ++localRequest;
    if (input !== previousInitialInput) {
      previousInitialInput = input;
      setLocalProjection(undefined);
    }
    if (
      revision === undefined ||
      (networkAuthorityInput === input &&
        networkAuthorityRevision() === revision) ||
      !queryOptions.enabled ||
      !graphqlSoupProjectionSupported() ||
      !input ||
      !host ||
      !('initial' in input)
    ) {
      localEvaluationPending = false;
      return;
    }
    const initial = input.initial;
    if (!initial) {
      localEvaluationPending = false;
      return;
    }
    const filters = initial.filters ?? {};
    const sortMethod = initial.sortMethod;
    if (sortMethod !== 'CREATED_AT' && sortMethod !== 'UPDATED_AT') {
      localEvaluationPending = false;
      return;
    }
    const baseline = soupReconciliationBaseline(records, sortMethod);
    if (!baseline) {
      setLocalProjection(undefined);
      localEvaluationPending = false;
      return;
    }
    const sortDirection = initial.sortDirection ?? 'DESC';
    const limit = initial.limit ?? 20;

    if (localEvaluationRunning) {
      localEvaluationPending = true;
      return;
    }
    localEvaluationRunning = true;
    localEvaluationPending = false;

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
            baseline,
          });
          if (result.kind !== 'reconciled') return;
          if (requestId !== localRequest) {
            discarded = true;
            return;
          }
          // Loaded server pages may exceed the bounded fragment-read API.
          // Every chunk must still belong to the same reconciliation revision.
          const chunks = [];
          for (
            let offset = 0;
            offset < Math.max(1, result.keys.length);
            offset += 500
          ) {
            chunks.push(
              await readRecordsByKeys(
                host,
                soupItemSelection,
                result.keys.slice(offset, offset + 500)
              )
            );
          }
          const latestRevision = await host.currentRevision();
          if (requestId !== localRequest) {
            discarded = true;
            return;
          }
          if (
            chunks.some((chunk) => result.revision !== chunk.revision) ||
            result.revision !== latestRevision ||
            result.revision !== expectedRevision
          ) {
            discarded = true;
            retryCount += 1;
            expectedRevision = latestRevision;
            setCurrentCacheRevision(latestRevision);
            continue;
          }
          const items = materializeReconciledSoup(
            result.keys,
            chunks.flatMap((chunk) => chunk.records),
            records
          ).flatMap((record) => {
            const item = mapGraphqlSoupItem(record);
            return item ? [item] : [];
          });
          setLocalProjection({
            revision: latestRevision,
            baseline: records,
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
          span.setAttr('evaluation.retained_count', result.retainedKeys.length);
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
        localEvaluationRunning = false;
        if (localEvaluationPending) {
          localEvaluationPending = false;
          setLocalEvaluationTrigger((trigger) => trigger + 1);
        }
      }
    })();
  });

  const query = createUrqlInfiniteQuery<
    SoupQuery,
    SoupQueryVariables,
    string | null,
    ServerProjection
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
        if (result.data) setBaselineGeneration(cacheGeneration);
        if (page.pageIndex !== 0) return;
        const metadata = normalizedCacheResultMetadata(result);
        if (metadata?.source !== 'live-network' || !metadata.revision) return;
        networkAuthorityInput = firstInput;
        batch(() => {
          setCurrentCacheRevision(metadata.revision);
          setNetworkAuthorityRevision(metadata.revision);
          setLocalProjection(undefined);
        });
        recordAuthority('network');
        finishStaleFallback('network');
      },
      select: ({ pages }) => ({
        records: pages.flatMap((page) => page.user.soup.items),
        data: {
          entities: pages.flatMap((page) =>
            mapSoupPageToEntityList(mapGraphqlSoupPage(page), {
              instructionsIdQuery,
              showSupportedForeignEntities,
            })
          ),
          groups: undefined,
        },
      }),
    };
  });

  // Snapshot the reactive normalized rows: their object identities may remain
  // stable across writes, but baseline membership/sort evidence must not mutate
  // beneath an in-flight reconciliation.
  const serverRecords = createMemo(() =>
    baselineGeneration() === cacheGeneration
      ? (query.data?.records ?? []).map((record) => ({ ...record }))
      : []
  );

  const authoritativeLocalProjection = (): LocalProjection | undefined => {
    const local = localProjection();
    const revision = currentCacheRevision();
    return local &&
      local.revision === revision &&
      local.baseline === serverRecords()
      ? local
      : undefined;
  };
  const networkIsAuthoritative = (): boolean =>
    networkAuthorityInput === firstPageInput() &&
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
      if (networkIsAuthoritative()) return query.data?.data;
      const local = authoritativeLocalProjection();
      return local?.data ?? query.data?.data ?? localProjection()?.data;
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
      // The display overlay never owns or resets the server cursor chain.
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
