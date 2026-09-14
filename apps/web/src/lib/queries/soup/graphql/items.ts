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
  type MailItemFieldsFragment,
  MailItemFieldsFragmentDoc,
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
  untrack,
} from 'solid-js';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from '../items';
import { mapSoupPageToEntityList } from '../transform-utils';
import { makeGraphqlSoupInput } from './ast';
import { isCachedMailView, materializeMailView } from './mail-view';
import {
  materializeReconciledSoup,
  soupItemKey,
  soupReconciliationBaseline,
  unreconciledServerRecords,
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
  const [offline, setOffline] = createSignal(
    typeof navigator !== 'undefined' && !navigator.onLine
  );
  const updateConnectivity = () => setOffline(!navigator.onLine);
  if (typeof window !== 'undefined') {
    window.addEventListener('online', updateConnectivity);
    window.addEventListener('offline', updateConnectivity);
    onCleanup(() => {
      window.removeEventListener('online', updateConnectivity);
      window.removeEventListener('offline', updateConnectivity);
    });
  }
  const [fetchingMailPage, setFetchingMailPage] = createSignal(false);

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
    input: GraphqlSoupInput;
    generation: number;
    baselineKeys: ReadonlySet<string>;
    displayedKeys: ReadonlySet<string>;
    data: SoupAstItemsData;
    mail?: {
      nextCursor: string | null;
      revision: CacheRevision;
      records: GraphqlSoupItem[];
    };
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
  const mailItemSelection = selectRecords(MailItemFieldsFragmentDoc);
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
    const requestGeneration = cacheGeneration;
    if (input !== previousInitialInput) {
      previousInitialInput = input;
      setLocalProjection(undefined);
    }
    const existing = untrack(localProjection);
    if (
      existing?.mail &&
      existing.input === input &&
      existing.generation === cacheGeneration &&
      existing.mail.revision === revision
    )
      return;
    if (
      revision === undefined ||
      (networkAuthorityInput === input &&
        networkAuthorityRevision() === revision &&
        !offline() &&
        !query.error?.networkError) ||
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
    if (!baseline && !isCachedMailView(initial.emailView)) {
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
          const mailView = isCachedMailView(initial.emailView)
            ? initial.emailView
            : undefined;
          let result = await host.entityFilter({
            filters,
            sortMethod,
            sortDirection,
            limit,
            ...(mailView ? { mail: { view: mailView } } : { baseline }),
          });
          if (
            mailView &&
            (result.kind === 'unsupported' || result.kind === 'incomplete')
          ) {
            if (!baseline) return;
            result = await host.entityFilter({
              filters,
              sortMethod,
              sortDirection,
              limit,
              baseline,
            });
          }
          if (result.kind !== 'reconciled' && result.kind !== 'mail-page')
            return;
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
                result.kind === 'mail-page'
                  ? mailItemSelection
                  : soupItemSelection,
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
          const timestamps =
            result.kind === 'mail-page'
              ? new Map(
                  result.keys.map((key, i) => [key, result.sortTimestamps[i]])
                )
              : undefined;
          const reconciledRecords = materializeReconciledSoup(
            result.keys,
            chunks.flatMap((chunk) => chunk.records),
            result.kind === 'mail-page' ? [] : records
          ).flatMap((record) => {
            const ts = timestamps?.get(soupItemKey(record));
            if (!ts || !mailView || result.kind !== 'mail-page')
              return [record];
            const projected = materializeMailView(
              record as MailItemFieldsFragment,
              mailView,
              ts
            );
            return projected ? [projected] : [];
          });
          const items = reconciledRecords.flatMap((record) => {
            const item = mapGraphqlSoupItem(record);
            return item ? [item] : [];
          });
          setLocalProjection({
            input,
            generation: requestGeneration,
            baselineKeys: new Set(
              result.kind === 'mail-page' ? [] : records.map(soupItemKey)
            ),
            displayedKeys: new Set(reconciledRecords.map(soupItemKey)),
            ...(result.kind === 'mail-page'
              ? {
                  mail: {
                    nextCursor: result.nextCursor,
                    revision: result.revision,
                    records: reconciledRecords,
                  },
                }
              : {}),
            data: {
              cachedMail: result.kind === 'mail-page',
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
          span.setAttr(
            'evaluation.retained_count',
            result.kind === 'reconciled' ? result.retainedKeys.length : 0
          );
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

  const serverRecordKeys = createMemo(
    () => new Set(serverRecords().map(soupItemKey))
  );

  // Retain same-query rows across revisions and page additions, not across a
  // query/generation change or removal of the baseline they were built from.
  // Publishing a replacement still requires all the revision checks above.
  const displayLocalProjection = (): LocalProjection | undefined => {
    const local = localProjection();
    if (
      !local ||
      local.input !== firstPageInput() ||
      local.generation !== cacheGeneration
    )
      return undefined;
    const keys = serverRecordKeys();
    for (const key of local.baselineKeys) {
      if (!keys.has(key)) return undefined;
    }
    return local;
  };
  const networkIsAuthoritative = (): boolean =>
    !offline() &&
    !query.error?.networkError &&
    networkAuthorityInput === firstPageInput() &&
    networkAuthorityRevision() !== undefined &&
    networkAuthorityRevision() === currentCacheRevision();

  // An overlay covers only the server rows that existed when it was evaluated.
  // New server pages must render immediately, even if the next evaluation stalls
  // or fails. Preserve covered decisions and local additions, then append new
  // rows in server-page order until a successful reconciliation orders the union.
  const displayData = createMemo((): SoupAstItemsData | undefined => {
    if (networkIsAuthoritative()) return query.data?.data;
    const local = displayLocalProjection();
    if (!local) return query.data?.data;
    if (local.mail) return local.data;
    const additions = unreconciledServerRecords(
      serverRecords(),
      local.baselineKeys,
      local.displayedKeys
    ).flatMap((record) => {
      const item = mapGraphqlSoupItem(record);
      return item ? [item] : [];
    });
    if (additions.length === 0) return local.data;
    const entities = mapSoupPageToEntityList(
      { items: additions, next_cursor: undefined },
      {
        instructionsIdQuery,
        showSupportedForeignEntities: options().showSupportedForeignEntities,
      }
    );
    return entities.length === 0
      ? local.data
      : {
          ...local.data,
          entities: [...local.data.entities, ...entities],
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
    data: displayData,
    error,
    isSupported,
    isEnabled: () => query.isEnabled,
    isLoading: () => query.isLoading && displayLocalProjection() === undefined,
    isFetching: () => query.isFetching,
    isFetchingNextPage: () => fetchingMailPage() || query.isFetchingNextPage,
    // Current-query cache results are usable data, not previous-tab
    // placeholders. In particular, local recomputation must not animate the
    // mobile tab-loading bar or make the view report that it has no data.
    isPlaceholderData: () => false,
    hasNextPage: () =>
      !networkIsAuthoritative() && displayLocalProjection()?.mail
        ? displayLocalProjection()?.mail?.nextCursor != null
        : query.hasNextPage,
    fetchNextPage: async () => {
      const local = displayLocalProjection();
      if (!local?.mail || networkIsAuthoritative()) {
        await query.fetchNextPage();
        return;
      }
      if (!local.mail.nextCursor || fetchingMailPage()) return;
      const initial =
        'initial' in local.input ? local.input.initial : undefined;
      const host = getGraphqlSoupCacheHost();
      if (!initial || !host || !isCachedMailView(initial.emailView)) return;
      const mailView = initial.emailView;
      setFetchingMailPage(true);
      try {
        const result = await host.entityFilter({
          filters: initial.filters ?? {},
          sortMethod: initial.sortMethod ?? 'UPDATED_AT',
          sortDirection: initial.sortDirection ?? 'DESC',
          limit: initial.limit ?? 20,
          mail: { view: initial.emailView, cursor: local.mail.nextCursor },
        });
        if (displayLocalProjection() !== local) return;
        if (result.kind === 'stale-cursor') {
          setLocalProjection(undefined);
          setLocalEvaluationTrigger((value) => value + 1);
          return;
        }
        if (result.kind !== 'mail-page') return;
        const selected = await readRecordsByKeys(
          host,
          mailItemSelection,
          result.keys
        );
        const currentRevision = await host.currentRevision();
        if (
          displayLocalProjection() !== local ||
          result.revision !== local.mail.revision ||
          selected.revision !== result.revision ||
          currentRevision !== result.revision
        ) {
          setLocalEvaluationTrigger((value) => value + 1);
          return;
        }
        const keys = [...local.displayedKeys, ...result.keys];
        const timestamps = new Map(
          result.keys.map((key, i) => [key, result.sortTimestamps[i]])
        );
        const records = materializeReconciledSoup(
          keys,
          selected.records,
          local.mail.records
        ).flatMap((record) => {
          const ts = timestamps.get(soupItemKey(record));
          if (!ts) return [record];
          const projected = materializeMailView(
            record as MailItemFieldsFragment,
            mailView,
            ts
          );
          return projected ? [projected] : [];
        });
        const items = records.flatMap((record) => {
          const item = mapGraphqlSoupItem(record);
          return item ? [item] : [];
        });
        setLocalProjection({
          ...local,
          displayedKeys: new Set(keys),
          mail: {
            nextCursor: result.nextCursor,
            revision: result.revision,
            records,
          },
          data: {
            cachedMail: true,
            entities: mapSoupPageToEntityList(
              { items, next_cursor: undefined },
              {
                instructionsIdQuery,
                showSupportedForeignEntities:
                  options().showSupportedForeignEntities,
              }
            ),
            groups: undefined,
          },
        });
      } finally {
        setFetchingMailPage(false);
      }
    },
    resetToInitialPage: () => {
      query.resetToInitialPage();
      if (displayLocalProjection()?.mail) {
        setLocalProjection(undefined);
        setLocalEvaluationTrigger((value) => value + 1);
      }
    },
    refresh: async () => {
      if (firstPageInput() === undefined) return;
      await query.refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
    },
  };
}
