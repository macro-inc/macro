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
import {
  createUrqlInfiniteQuery,
  type UrqlInfiniteData,
} from '@app/lib/urql-solid';
import { createBrowserOfflineSignal } from '@core/util/connectivity';
import { isTransientRequestError } from '@core/util/request-error';
import { Telemetry } from '@macro-inc/observability';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import type { SoupApiItem } from '@service-storage/generated/schemas';
import {
  ChannelListItemFieldsFragmentDoc,
  ChannelListSoupDocument,
  type ChannelListSoupQuery,
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
import { NIL as NIL_UUID } from 'uuid';
import { querySnapshot } from '../../../graphql-cache/exchange/live-query';
import { createLiveQuery } from '../../../graphql-cache/solid/create-live-query';
import { createKeyedProjection } from '../../../urql-solid/create-keyed-projection';
import { registerChannelNotificationRefresh } from '../../channel/register-notification-refresh';
import { soupQueryExcludesDone } from '../excludes-done';
import type { SoupAstBody, SoupAstItemsData, SoupAstParams } from '../items';
import { soupEntityTimestamp } from '../page-timestamp';
import {
  mapApiSoupItemToEntity,
  mapSoupPageToEntityList,
} from '../transform-utils';
import { registerGraphqlSoupRevalidations } from './active-queries';
import { makeGraphqlSoupInput } from './ast';
import { isCachedMailView, materializeMailView } from './mail-view';
import {
  usePendingGraphqlSoupDeleteIds,
  withoutPendingGraphqlSoupDeletes,
} from './optimistic-deletions';
import {
  usePendingGraphqlSoupDone,
  withPendingDoneIds,
} from './optimistic-done';
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
  /** Reuse local Mail evaluation beneath a separately subscribed grouped query. */
  localOnly?: boolean;
  networkPaused?: boolean;
  keepPreviousData?: boolean;
  projection?: 'channel-list';
  /** Reconcile indexed members while retaining server-only email rows. */
  localReconciliation?: 'without-email';
  showSupportedForeignEntities?: boolean;
};

export type GraphqlSoupAstItemsQuery = {
  localRevision?: Accessor<CacheRevision | undefined>;
  localOptimistic?: Accessor<boolean>;
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

const itemsById = (items: readonly SoupApiItem[]) =>
  Object.fromEntries(
    items.map((item) => [mapApiSoupItemToEntity(item).id, item])
  );

/** Creates the live urql query for a flat Soup AST request. */
export function createGraphqlSoupAstItemsQuery(
  args: Accessor<GraphqlSoupAstItemsQueryArgs>,
  options: Accessor<GraphqlSoupAstItemsQueryOptions>
): GraphqlSoupAstItemsQuery {
  const instructionsIdQuery = useInstructionsMdIdQuery();
  const pendingDeleteIds = usePendingGraphqlSoupDeleteIds();
  const pendingDone = usePendingGraphqlSoupDone();
  const excludesDone = createMemo(() => soupQueryExcludesDone([args().body]));
  const offline = createBrowserOfflineSignal();
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
    pageParams: readonly (string | null)[];
    data: SoupAstItemsData;
    records: Accessor<GraphqlSoupItem[]>;
  };
  type LocalProjection = {
    input: GraphqlSoupInput;
    generation: number;
    baselineKeys: ReadonlySet<string>;
    displayedKeys: ReadonlySet<string>;
    withoutEmail: boolean;
    data: SoupAstItemsData;
    mail?: {
      nextCursor: string | null;
      revision: CacheRevision;
      optimistic: boolean;
      records: GraphqlSoupItem[];
    };
  };
  type UnpersistedPage = {
    input: GraphqlSoupInput | undefined;
    generation: number;
    observation: number;
  };
  const [unpersistedPages, setUnpersistedPages] = createSignal<
    ReadonlyMap<number, UnpersistedPage>
  >(new Map());
  const [currentCacheRevision, setCurrentCacheRevision] = createSignal<
    CacheRevision | undefined
  >();
  const [networkAuthorityRevision, setNetworkAuthorityRevision] = createSignal<
    CacheRevision | undefined
  >();
  const [legacyLocalProjection, setLocalProjection] = createSignal<
    LocalProjection | undefined
  >();
  let maintainedProjection: Accessor<LocalProjection | undefined> | undefined;
  let maintainedQueryAvailable: Accessor<boolean> = () => false;
  const localProjection = () =>
    maintainedProjection?.() ?? legacyLocalProjection();
  const [localEvaluationTrigger, setLocalEvaluationTrigger] = createSignal(0);
  const queryDocument = () =>
    options().projection === 'channel-list'
      ? ChannelListSoupDocument
      : SoupDocument;
  const soupItemSelection = selectRecords(SoupItemFieldsFragmentDoc);
  const channelListItemSelection = selectRecords(
    ChannelListItemFieldsFragmentDoc
  );
  const mailItemSelection = selectRecords(MailItemFieldsFragmentDoc);
  let localRequest = 0;
  let localEvaluationRunning = false;
  let localEvaluationPending = false;
  let cacheGeneration = 0;
  let cacheObservation = 0;
  let disposed = false;
  onCleanup(() => {
    disposed = true;
  });
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

  const hasUnpersistedPages = (input: GraphqlSoupInput | undefined) =>
    [...unpersistedPages().values()].some(
      (page) => page.input === input && page.generation === cacheGeneration
    );
  const forgetUnpersistedPage = (index: number) => {
    setUnpersistedPages((pages) => {
      if (!pages.has(index)) return pages;
      const next = new Map(pages);
      next.delete(index);
      return next;
    });
  };
  const acknowledgeNetworkPage = async (
    index: number,
    page: UnpersistedPage,
    persistence: Promise<CacheRevision | undefined>
  ): Promise<void> => {
    let revision: CacheRevision | undefined;
    try {
      revision = await persistence;
    } catch {
      // A failed cache write cannot revoke the successful network snapshot.
      return;
    }
    if (
      revision === undefined ||
      disposed ||
      page.generation !== cacheGeneration ||
      page.input !== firstPageInput() ||
      unpersistedPages().get(index) !== page
    )
      return;
    batch(() => {
      // Cache pushes (including optimistic writes) can arrive before this ack.
      // Never rewind their watermark or republish/clear the visible row data.
      if (cacheObservation === page.observation) {
        setCurrentCacheRevision(revision);
        cacheObservation += 1;
      }
      networkAuthorityInput = page.input;
      setNetworkAuthorityRevision(revision);
      forgetUnpersistedPage(index);
    });
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
      setUnpersistedPages(new Map());
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
      cacheObservation += 1;
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
    const withoutEmail = queryOptions.localReconciliation === 'without-email';
    // Email membership remains server-owned. Leaving it out of the overlay's
    // baseline makes displayData retain those rows, including later pages.
    const records = withoutEmail
      ? serverRecords().filter(
          (record) => record.__typename !== 'GraphqlSoupEmailThread'
        )
      : serverRecords();
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
      hasUnpersistedPages(input) ||
      (networkAuthorityInput === input &&
        networkAuthorityRevision() === revision &&
        !offline() &&
        !query.error?.networkError &&
        !(
          input &&
          'initial' in input &&
          isCachedMailView(input.initial?.emailView)
        )) ||
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
    const filters = withoutEmail
      ? {
          ...initial.filters,
          emailFilter: { tree: { literal: { threadId: NIL_UUID } } },
        }
      : (initial.filters ?? {});
    const mailView =
      !withoutEmail && isCachedMailView(initial.emailView)
        ? initial.emailView
        : undefined;
    // Maintained queries own non-Mail reconciliation on current hosts. The
    // existing path also supports native binaries predating this capability.
    if (!mailView && maintainedQueryAvailable()) return;
    const sortMethod = initial.sortMethod;
    if (sortMethod !== 'CREATED_AT' && sortMethod !== 'UPDATED_AT') {
      localEvaluationPending = false;
      return;
    }
    const baseline = soupReconciliationBaseline(records, sortMethod);
    if (!baseline && !mailView) {
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
      let retryCount = 0;
      let discarded = false;
      let outcome: 'success' | 'incomplete' | 'error' = 'incomplete';
      try {
        for (let attempt = 0; attempt < 3; attempt += 1) {
          if (requestId !== localRequest) {
            discarded = true;
            return;
          }
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
              await readRecordsByKeys<GraphqlSoupItem>(
                host,
                result.kind === 'mail-page'
                  ? mailItemSelection
                  : queryOptions.projection === 'channel-list'
                    ? channelListItemSelection
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
            result.revision !== latestRevision
          ) {
            discarded = true;
            retryCount += 1;
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
          batch(() => {
            setLocalProjection({
              input,
              generation: requestGeneration,
              baselineKeys: new Set(
                result.kind === 'mail-page' ? [] : records.map(soupItemKey)
              ),
              displayedKeys: new Set(reconciledRecords.map(soupItemKey)),
              withoutEmail,
              ...(result.kind === 'mail-page'
                ? {
                    mail: {
                      nextCursor: result.nextCursor,
                      revision: result.revision,
                      optimistic: result.optimistic,
                      records: reconciledRecords,
                    },
                  }
                : {}),
              data: {
                cachedMail: result.kind === 'mail-page',
                itemsById: itemsById(items),
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
            // The filter, fragments, and final revision agree. A newer coherent
            // page is valid even if hydration advanced past the initial read.
            // Publish both result kinds' watermarks: the Mail guard avoids a
            // rescan, and reconnect cannot make an older network snapshot authoritative.
            setCurrentCacheRevision(result.revision);
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

  // Keep the selector stable across activity/filter changes. The observer
  // caches projections by selector and page identity; rebuilding the closure
  // would remap and reconcile every notification when merely disabling a view.
  const projectionSortMethod = createMemo(() => args().params.sort_method);
  const projectionForeignEntities = createMemo(
    () => options().showSupportedForeignEntities
  );
  const projectionInstructionsId = createMemo(() =>
    instructionsIdQuery.isSuccess ? instructionsIdQuery.data : undefined
  );
  const selectPages = createMemo(() => {
    // The mapper reads this query inside the untracked observer callback.
    // Track its resolved id here so cached pages reselect when it changes.
    const instructionsId = projectionInstructionsId();
    const sortMethod = projectionSortMethod();
    const showSupportedForeignEntities = projectionForeignEntities();
    const [inputRecords, setInputRecords] = createSignal<
      { key: string; record: GraphqlSoupItem }[]
    >([]);
    const projected = createKeyedProjection(
      inputRecords,
      (item) => item.key,
      ({ record }) => {
        const item = mapGraphqlSoupItem(record);
        return {
          id: soupItemKey(record),
          entity: item
            ? mapSoupPageToEntityList(
                { items: [item], next_cursor: undefined },
                {
                  instructionsIdQuery: {
                    isSuccess: instructionsId !== undefined,
                    data: instructionsId,
                  },
                  showSupportedForeignEntities,
                }
              )[0]
            : undefined,
          timestamp: item
            ? soupEntityTimestamp(mapApiSoupItemToEntity(item), sortMethod)
            : undefined,
        };
      }
    );
    const data = createMemo(() => {
      const entities: SoupAstItemsData['entities'] = [];
      let oldest = Infinity;
      for (const item of projected()) {
        if (item.entity) entities.push(item.entity);
        if (item.timestamp !== undefined)
          oldest = Math.min(oldest, item.timestamp);
      }
      return {
        entities,
        groups: undefined,
        oldestFetchedTimestamp: Number.isFinite(oldest) ? oldest : undefined,
      };
    });
    return ({
      pages,
      pageParams,
    }: UrqlInfiniteData<
      SoupQuery | ChannelListSoupQuery,
      string | null
    >): ServerProjection => {
      const records = pages.flatMap<GraphqlSoupItem>(
        (page) => page.user.soup.items
      );
      untrack(() => {
        const previous = inputRecords();
        if (
          previous.length !== records.length ||
          previous.some((item, index) => item.record !== records[index])
        ) {
          const byKey = new Map(previous.map((item) => [item.key, item]));
          const occurrences = new Map<string, number>();
          setInputRecords(
            records.map((record) => {
              const identity = soupItemKey(record);
              const occurrence = occurrences.get(identity) ?? 0;
              occurrences.set(identity, occurrence + 1);
              const key = `${identity}:${occurrence}`;
              const existing = byKey.get(key);
              return existing?.record === record ? existing : { key, record };
            })
          );
        }
      });
      return {
        // Raw wire records are reconciliation evidence, not reactive UI state.
        // Publish them atomically without walking their entire notification
        // payload again. Mapped entities retain deep reactivity and identity.
        records: () =>
          pages.flatMap<GraphqlSoupItem>(
            (page) => querySnapshot(page).user.soup.items
          ),
        pageParams,
        data: data(),
      };
    };
  });

  const query = createUrqlInfiniteQuery<
    SoupQuery | ChannelListSoupQuery,
    SoupQueryVariables,
    string | null,
    ServerProjection
  >(() => {
    const firstInput = firstPageInput();
    const queryOptions = options();

    return {
      query: queryDocument(),
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
      enabled:
        queryOptions.enabled &&
        !queryOptions.localOnly &&
        firstInput !== undefined,
      requestPolicy: queryOptions.networkPaused
        ? 'cache-only'
        : 'cache-and-network',
      keepPreviousData: queryOptions.keepPreviousData ?? false,
      onResult: (result, page) => {
        if (!result.data) return;
        setBaselineGeneration(cacheGeneration);
        const metadata = normalizedCacheResultMetadata(result);
        if (metadata?.source !== 'live-network') {
          // An affected/cache result already reflects local state. Its pending
          // network acknowledgement may no longer claim authority over it.
          forgetUnpersistedPage(page.pageIndex);
          return;
        }
        if (metadata.persistence) {
          const pending: UnpersistedPage = {
            input: firstInput,
            generation: cacheGeneration,
            observation: cacheObservation,
          };
          localRequest += 1;
          batch(() => {
            setUnpersistedPages((pages) =>
              new Map(
                [...pages].filter(
                  ([, entry]) =>
                    entry.input === firstInput &&
                    entry.generation === cacheGeneration
                )
              ).set(page.pageIndex, pending)
            );
            // Retain pending Mail rows while the new server page is persisted.
            if (!untrack(localProjection)?.mail) setLocalProjection(undefined);
          });
          recordAuthority('network');
          finishStaleFallback('network');
          void acknowledgeNetworkPage(
            page.pageIndex,
            pending,
            metadata.persistence
          );
          return;
        }
        forgetUnpersistedPage(page.pageIndex);
        if (page.pageIndex !== 0 || !metadata.revision) return;
        networkAuthorityInput = firstInput;
        cacheObservation += 1;
        batch(() => {
          setCurrentCacheRevision(metadata.revision);
          setNetworkAuthorityRevision(metadata.revision);
          // Keep same-view Mail evidence while checking the new revision.
          // A server page cannot supersede an unsettled offline draft.
          if (!untrack(localProjection)?.mail) setLocalProjection(undefined);
        });
        recordAuthority('network');
        finishStaleFallback('network');
      },
      select: selectPages(),
    };
  });

  onCleanup(
    registerGraphqlSoupRevalidations(() => {
      if (!query.isEnabled) return [];
      const cursors = new Set([null, ...(query.data?.pageParams ?? [])]);
      return [...cursors].flatMap((cursor) => {
        const input = inputForCursor(cursor);
        return input
          ? [{ document: queryDocument(), variables: { input } }]
          : [];
      });
    }, getGraphqlSoupClient)
  );

  registerChannelNotificationRefresh(() => ({
    client: getGraphqlSoupClient(),
    // urql retains loaded pages after errors; keep them registered for retry.
    queries:
      options().projection === 'channel-list'
        ? [...new Set([null, ...(query.data?.pageParams ?? [])])].flatMap(
            (cursor) => {
              const input = inputForCursor(cursor);
              return input
                ? [{ document: queryDocument(), variables: { input } }]
                : [];
            }
          )
        : [],
    reader: {
      enabled: query.isEnabled && !options().networkPaused,
      fetching: query.isFetching,
      filtered: true,
      notificationIds: query.isSuccess
        ? (query.data?.records() ?? []).flatMap((item) =>
            item.__typename === 'GraphqlSoupChannel' &&
            'unreadNotifications' in item
              ? (item.unreadNotifications?.map((n) => n.id) ?? [])
              : []
          )
        : [],
    },
  }));

  // Capture membership/sort evidence for each published projection, so a later
  // cache revision cannot change the baseline of an in-flight reconciliation.
  const serverRecords = createMemo(() =>
    baselineGeneration() === cacheGeneration
      ? (query.data?.records() ?? []).map((record) => ({ ...record }))
      : []
  );

  const serverRecordKeys = createMemo(
    () => new Set(serverRecords().map(soupItemKey))
  );

  const live = createLiveQuery<GraphqlSoupItem>({
    host: getGraphqlSoupCacheHost,
    query: () => {
      if (!getGraphqlSoupCacheHost()?.liveQueries) return;
      const input = firstPageInput();
      const queryOptions = options();
      if (
        !queryOptions.enabled ||
        !graphqlSoupProjectionSupported() ||
        !input ||
        !('initial' in input) ||
        !input.initial ||
        hasUnpersistedPages(input)
      )
        return;
      const initial = input.initial;
      const withoutEmail = queryOptions.localReconciliation === 'without-email';
      if (!withoutEmail && isCachedMailView(initial.emailView)) return;
      if (
        initial.sortMethod !== 'CREATED_AT' &&
        initial.sortMethod !== 'UPDATED_AT'
      )
        return;
      const records = withoutEmail
        ? serverRecords().filter(
            (record) => record.__typename !== 'GraphqlSoupEmailThread'
          )
        : serverRecords();
      const baseline = soupReconciliationBaseline(records, initial.sortMethod);
      if (!baseline) return;
      return {
        source: {
          filters: withoutEmail
            ? {
                ...initial.filters,
                emailFilter: { tree: { literal: { threadId: NIL_UUID } } },
              }
            : (initial.filters ?? {}),
          sortMethod: initial.sortMethod,
          sortDirection: initial.sortDirection ?? 'DESC',
          limit: initial.limit ?? 20,
          baseline,
        },
        select:
          queryOptions.projection === 'channel-list'
            ? channelListItemSelection
            : soupItemSelection,
      };
    },
  });
  maintainedQueryAvailable = () =>
    live.status() !== 'idle' &&
    live.status() !== 'unsupported' &&
    live.status() !== 'error';
  const liveRecords = createMemo(() => {
    const snapshot = live.data();
    return snapshot
      ? materializeReconciledSoup(
          snapshot.keys,
          snapshot.records,
          serverRecords()
        )
      : [];
  });
  const liveItems = createKeyedProjection(
    liveRecords,
    soupItemKey,
    (record) => {
      const item = mapGraphqlSoupItem(record);
      return {
        id: soupItemKey(record),
        item,
        entity: item
          ? mapSoupPageToEntityList(
              { items: [item], next_cursor: undefined },
              {
                instructionsIdQuery,
                showSupportedForeignEntities:
                  options().showSupportedForeignEntities,
              }
            )[0]
          : undefined,
      };
    }
  );
  const liveEntities = createMemo(() =>
    liveItems().flatMap((row) => (row.entity ? [row.entity] : []))
  );
  maintainedProjection = createMemo(() => {
    const snapshot = live.data();
    const input = firstPageInput();
    if (!snapshot || !input || !maintainedQueryAvailable()) return;
    const withoutEmail = options().localReconciliation === 'without-email';
    return {
      input,
      generation: cacheGeneration,
      baselineKeys: new Set(
        serverRecords()
          .filter(
            (record) =>
              !withoutEmail || record.__typename !== 'GraphqlSoupEmailThread'
          )
          .map(soupItemKey)
      ),
      displayedKeys: new Set(liveRecords().map(soupItemKey)),
      withoutEmail,
      data: {
        cachedMail: false,
        get itemsById() {
          return itemsById(
            liveItems().flatMap((row) => (row.item ? [row.item] : []))
          );
        },
        get entities() {
          return liveEntities();
        },
        groups: undefined,
      },
    };
  });

  // Retain same-query rows across revisions and page additions, not across a
  // query/generation change or removal of the baseline they were built from.
  // Publishing a replacement still requires all the revision checks above.
  const displayLocalProjection = (): LocalProjection | undefined => {
    const local = localProjection();
    if (
      !local ||
      local.input !== firstPageInput() ||
      local.generation !== cacheGeneration ||
      local.withoutEmail !== (options().localReconciliation === 'without-email')
    )
      return undefined;
    // A partial projection with no visible rows after pending deletes cannot
    // prove that a folder is empty (it could contain only email). Keep initial
    // loading/errors until the server establishes membership.
    if (
      local.withoutEmail &&
      !query.data &&
      local.data.entities.every((entity) => pendingDeleteIds().has(entity.id))
    )
      return undefined;
    const keys = serverRecordKeys();
    for (const key of local.baselineKeys) {
      if (!keys.has(key)) return undefined;
    }
    return local;
  };
  const networkIsAuthoritative = (): boolean =>
    !displayLocalProjection()?.mail?.optimistic &&
    (hasUnpersistedPages(firstPageInput()) ||
      (!offline() &&
        !query.error?.networkError &&
        networkAuthorityInput === firstPageInput() &&
        networkAuthorityRevision() !== undefined &&
        networkAuthorityRevision() === currentCacheRevision()));

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

  const error = (): CombinedError | undefined => {
    const error = query.error;
    // A background transport failure must not replace usable current-query
    // cache results (including an empty result) with the full-screen error state.
    // Keep server responses (including HTTP auth failures), GraphQL errors,
    // and failures without current-query local proof visible.
    if (
      error &&
      isTransientRequestError(error) &&
      !error.response &&
      displayLocalProjection()
    ) {
      return undefined;
    }
    return error ?? undefined;
  };
  createComputed(
    on(error, (queryError) => {
      if (queryError) {
        Telemetry.error(queryError, { graphqlOperation: 'Soup' });
      }
    })
  );

  return {
    localRevision: () => displayLocalProjection()?.mail?.revision,
    localOptimistic: () => displayLocalProjection()?.mail?.optimistic ?? false,
    data: createMemo(() => {
      const data = displayData();
      return withoutPendingGraphqlSoupDeletes(
        data && {
          ...data,
          oldestFetchedTimestamp: query.data?.data.oldestFetchedTimestamp,
        },
        excludesDone()
          ? withPendingDoneIds(
              pendingDeleteIds(),
              data?.entities ?? [],
              pendingDone()
            )
          : pendingDeleteIds()
      );
    }),
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
            optimistic: result.optimistic,
            records,
          },
          data: {
            cachedMail: true,
            itemsById: itemsById(items),
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
      // An explicit list refresh rebuilds the cursor chain in order. The
      // notification queue observes isFetching and waits for this to finish.
      await query.refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
    },
  };
}
