import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
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
import { arrayEquals } from '../../../core/util/compareUtils';
import { createBrowserOfflineSignal } from '../../../core/util/connectivity';
import { isResponseFreeNetworkError } from '../../../core/util/request-error';
import { querySnapshot } from '../../../graphql-cache/exchange/live-query';
import { normalizedCacheResultMetadata } from '../../../graphql-cache/exchange/normalized-cache-exchange';
import { selectRecords } from '../../../graphql-cache/exchange/record-selection';
import {
  type CacheRevision,
  MAX_MAIL_THROUGH_ROWS,
} from '../../../graphql-cache/protocol';
import { emailThreadSortTs } from '../../../service-clients/service-storage/email-thread-sort';
import {
  ChannelListItemFieldsFragmentDoc,
  ChannelListSoupDocument,
  type ChannelListSoupQuery,
  MailItemFieldsFragmentDoc,
  SoupDocument,
  type SoupInitialInput,
  SoupItemFieldsFragmentDoc,
  type SoupQuery,
  type SoupQueryVariables,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import {
  type GraphqlSoupInput,
  type GraphqlSoupItem,
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
  graphqlSoupProjectionSupported,
  hasGraphqlCacheHost,
} from '../../../service-clients/service-storage/graphql-soup';
import { createUrqlInfiniteQuery } from '../../../urql-solid/create-urql-infinite-query';
import type { UrqlInfiniteData } from '../../../urql-solid/types';
import { registerChannelNotificationRefresh } from '../../channel/register-notification-refresh';
import { registerGraphqlSoupRevalidations } from './active-queries';
import { createPredicateQuery } from './create-predicate-query';
import { isCachedMailView } from './mail-view';
import {
  usePendingGraphqlSoupDeleteIds,
  withoutPendingSoupEntities,
} from './optimistic-deletions';
import { readSoupPage } from './read-soup-page';
import {
  materializeReconciledSoup,
  soupItemKey,
  soupReconciliationBaseline,
  unreconciledServerRecords,
} from './reconciliation';

/** A Soup query declaration. The source owns page cursors and cache baselines. */
export type SoupLiveQueryInput = Omit<SoupInitialInput, 'expand'>;

export type SoupLiveQueryOptions = {
  enabled?: boolean;
  networkPaused?: boolean;
  keepPreviousData?: boolean;
  /** Reuse local Mail evaluation beneath a grouped server query. */
  localOnly?: boolean;
  /** Select bounded unread evidence for channel navigation. */
  projection?: 'channel-list';
  /** Include indexed non-email rows while server pages supply email. */
  localReconciliation?: 'without-email';
};

// A page result can carry the viewer without its `soup` field. Selection runs
// over every loaded page, so such a page reads as unloaded instead of failing
// the whole list.
const hasSoupPage = (page: SoupQuery | ChannelListSoupQuery): boolean =>
  page.user?.soup != null;

/** Owns network pages, live cache records, Mail cursors, and fallback selection.
 * Data is a non-suspending accessor of reactive GraphQL records, before UI mapping.
 * This is the one GraphQL Soup list source; feature code reads it through
 * `useSoupAstItemsQuery`.
 */
export function createSoupLiveQuery(
  request: Accessor<SoupLiveQueryInput | undefined>,
  options: Accessor<SoupLiveQueryOptions> = () => ({})
) {
  const pendingDeleteIds = usePendingGraphqlSoupDeleteIds();
  const offline = createBrowserOfflineSignal();
  const [fetchingMailPage, setFetchingMailPage] = createSignal(false);
  // The position of the last local Mail row loaded (a page's `endCursor`).
  // Cache writes re-read the page through it, so a scrolled list neither
  // collapses to its first page nor loses its last row when mail arrives
  // above it. Native engines that predate positions report none and re-read
  // the first page.
  const [localMailEdge, setLocalMailEdge] = createSignal<string | null>(null);
  // Bumped when the page chain starts over (new input, reset to the first
  // page), so paging still in flight then cannot restore the old depth.
  let pagingGeneration = 0;
  // The last local Mail evaluation for this input succeeded, so cache writes
  // keep the page current; incomplete or failed ones leave the network page.
  const [localMailCurrent, setLocalMailCurrent] = createSignal(false);

  const firstPageInput = createMemo<GraphqlSoupInput | undefined>(() => {
    const input = request();
    return input ? { initial: { ...input, expand: true } } : undefined;
  });
  const inputForCursor = (
    cursor: string | null
  ): GraphqlSoupInput | undefined => {
    const input = firstPageInput();
    if (!input || !('initial' in input) || !input.initial) return;
    if (cursor === null) return input;
    return {
      continuation: {
        cursor,
        expand: true,
        emailView: input.initial.emailView,
        sortDirection: input.initial.sortDirection,
      },
    };
  };
  const isSupported = () => firstPageInput() !== undefined;
  const inputKey = createMemo(() =>
    JSON.stringify([options().projection, firstPageInput()])
  );
  type ServerProjection = {
    pageParams: readonly (string | null)[];
    records: Accessor<GraphqlSoupItem[]>;
    baseline: Accessor<GraphqlSoupItem[]>;
  };
  type LocalProjection = {
    input: GraphqlSoupInput;
    generation: number;
    baselineKeys: ReadonlySet<string>;
    displayedKeys: ReadonlySet<string>;
    withoutEmail: boolean;
    records: GraphqlSoupItem[];
    mail?: {
      nextCursor: string | null;
      revision: CacheRevision;
      optimistic: boolean;
      /** Position of the page's last row; null when the engine reports none. */
      edge: string | null;
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
  const [baselineInputKey, setBaselineInputKey] = createSignal<string>();
  let previousInitialInput: GraphqlSoupInput | undefined;
  let networkAuthorityInput: GraphqlSoupInput | undefined;
  // The server page fetched only to keep the server pages as deep as a local
  // Mail list (fetchNextPage). It never takes over from that list.
  let inStepPageIndex: number | undefined;
  let staleFallbackSpan: ReturnType<typeof Telemetry.span> | undefined;

  const recordAuthority = (
    source: 'network' | 'failed-network' | 'local' | 'stale-fallback',
    pageIndex?: number
  ) => {
    const span = Telemetry.span('graphql_cache.soup_authority');
    span.setAttr('authority.source', source);
    if (pageIndex !== undefined)
      span.setAttr('authority.page_index', pageIndex);
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
      setLocalMailCurrent(false);
    };
    const observeCurrentRevision = async () => {
      const observedGeneration = cacheGeneration;
      try {
        const revision = await host.currentRevision();
        if (
          observedGeneration === cacheGeneration &&
          currentCacheRevision() === undefined
        ) {
          setCurrentCacheRevision(revision);
        }
      } catch {
        // Keep network data usable while the local cache is unavailable.
      }
    };
    const unsubscribeChanges = host.onCacheChanged(
      (revision) => {
        cacheObservation += 1;
        if (
          networkAuthorityRevision() !== undefined &&
          networkAuthorityRevision() !== revision &&
          staleFallbackSpan === undefined
        ) {
          staleFallbackSpan = Telemetry.span(
            'graphql_cache.soup_stale_fallback'
          );
          recordAuthority('stale-fallback');
        }
        setCurrentCacheRevision(revision);
      },
      // The authority watermark must observe the same writes as the live view.
      { includeHydration: true }
    );
    const unsubscribeGeneration = host.onCacheGenerationChanged(() => {
      const span = Telemetry.span('graphql_cache.engine_generation_changed');
      span.end();
      cacheGeneration += 1;
      invalidateGeneration();
      fireAndForget(observeCurrentRevision(), 'soup-live-query');
    });
    fireAndForget(observeCurrentRevision(), 'soup-live-query');
    onCleanup(() => {
      staleFallbackSpan?.end();
      staleFallbackSpan = undefined;
      cacheGeneration += 1;
      unsubscribeChanges();
      unsubscribeGeneration();
    });
  });

  const selectPages = ({
    pages,
    pageParams,
  }: UrqlInfiniteData<
    SoupQuery | ChannelListSoupQuery,
    string | null
  >): ServerProjection => {
    const soupPages = pages.filter(hasSoupPage);
    return {
      pageParams,
      // Accessors keep raw payloads outside deep store reconciliation. Rows from
      // live urql pages retain their field subscriptions; baselines are snapshots.
      records: () =>
        soupPages.flatMap<GraphqlSoupItem>((page) => page.user.soup.items),
      baseline: () =>
        soupPages.flatMap<GraphqlSoupItem>(
          (page) => querySnapshot(page).user.soup.items
        ),
    };
  };

  const query = createUrqlInfiniteQuery<
    SoupQuery | ChannelListSoupQuery,
    SoupQueryVariables,
    string | null,
    ServerProjection
  >(() => {
    const firstInput = firstPageInput();
    const firstInputKey = inputKey();
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
        hasSoupPage(lastPage)
          ? (lastPage.user.soup.nextCursor ?? undefined)
          : undefined,
      enabled:
        queryOptions.enabled !== false &&
        !queryOptions.localOnly &&
        firstInput !== undefined,
      requestPolicy: queryOptions.networkPaused
        ? 'cache-only'
        : 'cache-and-network',
      keepPreviousData: queryOptions.keepPreviousData ?? false,
      onResult: (result, page) => {
        const metadata = normalizedCacheResultMetadata(result);
        if (result.data) {
          batch(() => {
            setBaselineGeneration(cacheGeneration);
            setBaselineInputKey(firstInputKey);
          });
        }
        if (result.error && metadata?.source === 'live-network') {
          // The exchange keeps the rows already shown; a failed response's
          // partial data claims no authority over them or the local rows.
          recordAuthority('failed-network', page.pageIndex);
          return;
        }
        if (!result.data) return;
        if (metadata?.source !== 'live-network') {
          // An affected/cache result already reflects local state. Its pending
          // network acknowledgement may no longer claim authority over it.
          forgetUnpersistedPage(page.pageIndex);
          return;
        }
        if (metadata.persistence) {
          if (
            page.pageIndex === inStepPageIndex &&
            untrack(displayLocalProjection)?.mail
          ) {
            forgetUnpersistedPage(page.pageIndex);
            return;
          }
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
          fireAndForget(
            acknowledgeNetworkPage(
              page.pageIndex,
              pending,
              metadata.persistence
            ),
            'soup-live-query'
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
      select: selectPages,
    };
  });

  onCleanup(
    registerGraphqlSoupRevalidations(
      () => {
        if (!query.isEnabled) return [];
        const cursors = new Set([null, ...(query.data?.pageParams ?? [])]);
        return [...cursors].flatMap((cursor) => {
          const input = inputForCursor(cursor);
          return input
            ? [{ document: queryDocument(), variables: { input } }]
            : [];
        });
      },
      getGraphqlSoupClient,
      () => cacheMaintained()
    )
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
      ? (query.data?.baseline() ?? [])
      : []
  );

  const serverRecordKeys = createMemo(
    () => new Set(serverRecords().map(soupItemKey))
  );

  const localSource = createMemo(() => {
    const input = firstPageInput();
    const queryOptions = options();
    if (
      queryOptions.enabled === false ||
      !graphqlSoupProjectionSupported() ||
      !input ||
      !('initial' in input) ||
      !input.initial ||
      hasUnpersistedPages(input)
    )
      return;
    const initial = input.initial;
    if (
      initial.sortMethod !== 'CREATED_AT' &&
      initial.sortMethod !== 'UPDATED_AT'
    )
      return;
    const withoutEmail = queryOptions.localReconciliation === 'without-email';
    const mailView =
      !withoutEmail && isCachedMailView(initial.emailView)
        ? initial.emailView
        : undefined;
    const records = withoutEmail
      ? serverRecords().filter(
          (record) => record.__typename !== 'GraphqlSoupEmailThread'
        )
      : serverRecords();
    const baseline = soupReconciliationBaseline(
      records.map((record) => {
        if (!mailView || record.__typename !== 'GraphqlSoupEmailThread')
          return record;
        const timestamp = emailThreadSortTs(record, mailView);
        return { ...record, createdAt: timestamp, updatedAt: timestamp };
      }),
      initial.sortMethod
    );
    if (!baseline) return;
    return {
      input,
      records,
      withoutEmail,
      mailView,
      select:
        queryOptions.projection === 'channel-list'
          ? channelListItemSelection
          : soupItemSelection,
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
    };
  });
  const live = createPredicateQuery<GraphqlSoupItem>({
    host: getGraphqlSoupCacheHost,
    query: () => {
      const definition = localSource();
      if (
        !getGraphqlSoupCacheHost()?.liveQueries ||
        !definition ||
        definition.mailView ||
        !definition.source.baseline
      )
        return;
      return {
        source: { ...definition.source, baseline: definition.source.baseline },
        select: definition.select,
      };
    },
  });
  maintainedQueryAvailable = () =>
    live.status() !== 'idle' &&
    live.status() !== 'unsupported' &&
    live.status() !== 'error';
  // Whether a write that updates the cache also updates this list: a local
  // Mail page that evaluates, or a maintained predicate query. Other lists
  // (unsupported filters, a cold cache) still read the server after writes.
  const cacheMaintained = (): boolean => {
    if (!hasGraphqlCacheHost()) return false;
    if (localSource()?.mailView)
      return localMailCurrent() && displayLocalProjection() !== undefined;
    // A folder list keeps its email rows from the server, and a maintained
    // query still loading leaves the server page on screen.
    return (
      options().localReconciliation !== 'without-email' &&
      live.status() === 'ready'
    );
  };
  const liveRecords = createMemo(
    () => {
      const snapshot = live.data();
      return snapshot
        ? materializeReconciledSoup(
            snapshot.keys,
            snapshot.records,
            serverRecords()
          )
        : [];
    },
    undefined,
    { equals: arrayEquals }
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
      records: liveRecords(),
    };
  });

  createEffect(() => {
    localEvaluationTrigger();
    const revision = currentCacheRevision();
    const definition = localSource();
    const input = firstPageInput();
    const requestId = ++localRequest;
    const requestGeneration = cacheGeneration;
    if (input !== previousInitialInput) {
      previousInitialInput = input;
      pagingGeneration += 1;
      setLocalProjection(undefined);
      setLocalMailEdge(null);
      setLocalMailCurrent(false);
    }
    // Server pages loaded while the network was authoritative.
    const loaded = definition?.records.length ?? 0;
    const edge = localMailEdge();
    const existing = untrack(localProjection);
    if (
      existing?.mail &&
      existing.input === input &&
      existing.generation === cacheGeneration &&
      existing.mail.revision === revision &&
      existing.mail.edge === edge &&
      [...existing.baselineKeys].every((key) => serverRecordKeys().has(key)) &&
      definition?.records.every(
        (record) =>
          existing.baselineKeys.has(soupItemKey(record)) ||
          existing.displayedKeys.has(soupItemKey(record))
      ) &&
      (existing.displayedKeys.size >= loaded ||
        existing.mail.nextCursor == null)
    )
      return;
    const host = getGraphqlSoupCacheHost();
    if (
      !definition ||
      !host ||
      revision === undefined ||
      (!definition.mailView &&
        (maintainedQueryAvailable() ||
          (networkAuthorityInput === input &&
            networkAuthorityRevision() === revision &&
            !offline() &&
            !query.error?.networkError)))
    ) {
      localEvaluationPending = false;
      if (!definition && !hasUnpersistedPages(input)) {
        setLocalProjection(undefined);
        setLocalMailCurrent(false);
      }
      return;
    }
    const {
      records,
      withoutEmail,
      mailView,
      source: { filters, sortMethod, sortDirection, limit, baseline },
    } = definition;
    if (localEvaluationRunning) {
      localEvaluationPending = true;
      return;
    }
    localEvaluationRunning = true;
    localEvaluationPending = false;

    fireAndForget(
      (async () => {
        const span = Telemetry.span('graphql_cache.soup_local_evaluation');
        let retryCount = 0;
        let discarded = false;
        let outcome: 'success' | 'incomplete' | 'error' = 'incomplete';
        let through = edge;
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
              baseline,
              ...(!mailView
                ? { limit }
                : through
                  ? {
                      // At least as deep as the server pages already shown.
                      limit: Math.min(
                        Math.max(limit, loaded),
                        MAX_MAIL_THROUGH_ROWS
                      ),
                      mail: { view: mailView, through },
                    }
                  : { limit, mail: { view: mailView } }),
            });
            // A position from a replaced engine: read from the top instead.
            if (result.kind === 'stale-cursor' && through) {
              through = null;
              continue;
            }
            if (mailView) {
              span.setAttr('evaluation.through', Boolean(through));
              if (result.kind === 'mail-page')
                span.setAttr('evaluation.depth', result.keys.length);
            }
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
            // Older native hosts accept but ignore the baseline on Mail reads.
            // Their omission cannot prove non-membership; retain the server list.
            if (
              result.kind === 'mail-page' &&
              result.retainedKeys === undefined &&
              records.some(
                (record) => !result.keys.includes(soupItemKey(record))
              )
            ) {
              setLocalProjection(undefined);
              return;
            }
            const selected = await readSoupPage(host, {
              page: result,
              select:
                result.kind === 'mail-page'
                  ? mailItemSelection
                  : definition.select,
              baseline: records,
              mailView,
            });
            if (requestId !== localRequest) {
              discarded = true;
              return;
            }
            if (selected.kind === 'stale') {
              discarded = true;
              retryCount += 1;
              setCurrentCacheRevision(selected.revision);
              continue;
            }
            const reconciledRecords = selected.records;
            batch(() => {
              setLocalProjection({
                input: definition.input,
                generation: requestGeneration,
                baselineKeys: new Set(records.map(soupItemKey)),
                displayedKeys: new Set(reconciledRecords.map(soupItemKey)),
                withoutEmail,
                ...(result.kind === 'mail-page'
                  ? {
                      mail: {
                        nextCursor: result.nextCursor,
                        revision: result.revision,
                        optimistic: result.optimistic,
                        edge: result.endCursor ?? null,
                      },
                    }
                  : {}),
                records: reconciledRecords,
              });
              // The next evaluation reads through this one's last row.
              if (result.kind === 'mail-page')
                setLocalMailEdge(result.endCursor ?? null);
              // Set here: a new edge reruns the effect, which supersedes
              // this request before its `finally`.
              if (mailView)
                setLocalMailCurrent(
                  result.kind === 'mail-page' &&
                    result.retainedKeys?.length === 0
                );
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
              result.retainedKeys?.length ?? 0
            );
            return;
          }
        } catch {
          outcome = 'error';
          // Transient evaluation failures retain the last coherent projection,
          // including offline rows absent from the server fallback.
        } finally {
          // Only the latest request decides, after any stale-revision retries.
          if (mailView && requestId === localRequest && outcome !== 'success')
            setLocalMailCurrent(false);
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
      })(),
      'soup-live-query'
    );
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
      local.records.every((record) => pendingDeleteIds().has(record.id))
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
      // Once the maintained view has caught up, keep its row stores visible.
      // Switching from network objects on the first edit would strand readers
      // holding the original row and replace identities during the interaction.
      ((!maintainedQueryAvailable() ||
        live.data()?.revision !== currentCacheRevision()) &&
        !offline() &&
        !query.error?.networkError &&
        networkAuthorityInput === firstPageInput() &&
        networkAuthorityRevision() !== undefined &&
        networkAuthorityRevision() === currentCacheRevision()));

  // An overlay covers only the server rows that existed when it was evaluated.
  // New server pages must render immediately, even if the next evaluation stalls
  // or fails. Preserve covered decisions and local additions, then append new
  // rows in server-page order until a successful reconciliation orders the union.
  const displayData = createMemo((): GraphqlSoupItem[] | undefined => {
    if (networkIsAuthoritative()) return query.data?.records();
    const local = displayLocalProjection();
    if (!local) return query.data?.records();
    // Mail merges new server evidence in its ordered through-read. Appending
    // it here would bypass membership decisions and the local cursor order.
    if (local.mail) return local.records;
    const additions = unreconciledServerRecords(
      serverRecords(),
      local.baselineKeys,
      local.displayedKeys
    );
    return additions.length ? [...local.records, ...additions] : local.records;
  });

  // Keeps the server pages as deep as a local Mail list, so it stays as deep
  // when the network page becomes authoritative again. Load More raises the
  // rows wanted, and one chain fetches pages until the server has them: the
  // infinite query coalesces a next page requested while one is in flight.
  // Not awaited: the local page is what the user sees. A failed page ends the
  // chain, and the next Load More retries it; so does a restarted page chain.
  let serverCatchUp: { generation: number; rows: number } | undefined;
  const fetchServerPagesInStep = (rows: number) => {
    if (serverCatchUp?.generation === pagingGeneration) {
      serverCatchUp.rows = Math.max(serverCatchUp.rows, rows);
      return;
    }
    const catchUp = { generation: pagingGeneration, rows };
    serverCatchUp = catchUp;
    fireAndForget(
      (async () => {
        try {
          while (
            catchUp.generation === pagingGeneration &&
            query.hasNextPage &&
            !offline() &&
            (query.data?.records().length ?? 0) < catchUp.rows
          ) {
            const pages = query.data?.pageParams.length ?? 0;
            inStepPageIndex = pages;
            await query.fetchNextPage();
            if ((query.data?.pageParams.length ?? 0) <= pages) return;
          }
        } finally {
          if (serverCatchUp === catchUp) serverCatchUp = undefined;
        }
      })(),
      'soup-live-query'
    );
  };
  const cachedMail = createMemo(
    () => !networkIsAuthoritative() && Boolean(displayLocalProjection()?.mail)
  );
  const error = (): CombinedError | undefined => {
    const error = query.error;
    // A local Mail list pages from the cache; the server page kept in step
    // behind it is retried on the next scroll and must not replace the list.
    if (query.isFetchNextPageError && cachedMail()) return undefined;
    // A background transport failure must not replace usable current-query
    // cache results (including an empty result) with the full-screen error state.
    // A normalized page is usable before local reconciliation finishes. Keep
    // server responses, uncached queries and failed continuation reads visible;
    // previous-filter or previous-generation pages are not fallback evidence.
    if (
      isResponseFreeNetworkError(error) &&
      options().enabled !== false &&
      isSupported() &&
      !query.isFetchNextPageError &&
      (displayLocalProjection() ||
        (query.data !== undefined &&
          baselineGeneration() === cacheGeneration &&
          baselineInputKey() === inputKey()))
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
    cacheMaintained,
    queryScope: () => JSON.stringify([firstPageInput(), cacheGeneration]),
    localRevision: () => displayLocalProjection()?.mail?.revision,
    localOptimistic: () => displayLocalProjection()?.mail?.optimistic ?? false,
    data: createMemo(() => {
      const records = displayData();
      return records && withoutPendingSoupEntities(records, pendingDeleteIds());
    }),
    fetchedRecords: () => query.data?.records() ?? [],
    cachedMail,
    error,
    isSupported,
    isEnabled: () => query.isEnabled,
    isLoading: () => {
      if (!query.isLoading) return false;
      const local = displayLocalProjection();
      if (!local) return true;
      // An empty local Mail page does not establish complete mailbox coverage.
      // Wait for the first query response before showing an online empty state.
      return (
        local.mail !== undefined &&
        local.records.length === 0 &&
        !offline() &&
        !options().networkPaused
      );
    },
    isFetching: () => query.isFetching,
    isFetchingNextPage: () =>
      fetchingMailPage() || (!cachedMail() && query.isFetchingNextPage),
    isFetchNextPageError: () => query.isFetchNextPageError,
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
        inStepPageIndex = undefined;
        await query.fetchNextPage();
        return;
      }
      if (!local.mail.nextCursor || fetchingMailPage()) return;
      const generation = pagingGeneration;
      const initial =
        'initial' in local.input ? local.input.initial : undefined;
      fetchServerPagesInStep(local.displayedKeys.size + (initial?.limit ?? 20));
      const host = getGraphqlSoupCacheHost();
      if (
        !initial ||
        !host ||
        !isCachedMailView(initial.emailView) ||
        initial.sortMethod === 'NOTIFIED_AT'
      )
        return;
      const mailView = initial.emailView;
      setFetchingMailPage(true);
      try {
        let result = await host.entityFilter({
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
        const definition = localSource();
        const reconcile =
          result.retainedKeys !== undefined &&
          result.endCursor &&
          definition?.source.baseline?.length;
        if (reconcile) {
          // A retained row may sit below the indexed cursor. Re-read the whole
          // window through the next page before publishing; append cannot keep
          // that union ordered and deduplication alone can produce no-op pages.
          result = await host.entityFilter({
            ...definition.source,
            limit: Math.min(
              local.displayedKeys.size + result.keys.length,
              MAX_MAIL_THROUGH_ROWS
            ),
            mail: { view: mailView, through: result.endCursor ?? undefined },
          });
          if (displayLocalProjection() !== local || result.kind !== 'mail-page')
            return;
        }
        const keys = reconcile
          ? result.keys
          : [...local.displayedKeys, ...result.keys];
        const selected = await readSoupPage(host, {
          page: result,
          select: mailItemSelection,
          baseline: reconcile ? definition.records : local.records,
          keys,
          mailView,
        });
        if (generation !== pagingGeneration) return;
        if (
          displayLocalProjection() !== local ||
          result.revision !== local.mail.revision ||
          selected.kind === 'stale'
        ) {
          // A cache write raced the page: read the list again through the
          // page's last row, at the new revision.
          batch(() => {
            setLocalMailEdge(result.endCursor ?? null);
            setLocalEvaluationTrigger((value) => value + 1);
          });
          return;
        }
        const records = selected.records;
        const edge = result.endCursor ?? null;
        // Together, so the evaluation sees the new edge already displayed.
        batch(() => {
          setLocalMailEdge(edge);
          setLocalMailCurrent(result.retainedKeys?.length === 0);
          setLocalProjection({
            ...local,
            baselineKeys: reconcile
              ? new Set(definition.records.map(soupItemKey))
              : local.baselineKeys,
            displayedKeys: new Set(keys),
            mail: {
              nextCursor: result.nextCursor,
              revision: result.revision,
              // Pending writes shown on earlier pages are still pending.
              optimistic:
                (local.mail?.optimistic ?? false) || result.optimistic,
              edge,
            },
            records,
          });
        });
      } finally {
        setFetchingMailPage(false);
      }
    },
    resetToInitialPage: () => {
      // Resetting server pages can invalidate the displayed projection's
      // baseline. Capture ownership before that happens, then clear its edge.
      const mail = localProjection()?.mail;
      pagingGeneration += 1;
      batch(() => {
        query.resetToInitialPage();
        setLocalMailEdge(null);
        setLocalMailCurrent(false);
        if (mail) {
          setLocalProjection(undefined);
          setLocalEvaluationTrigger((value) => value + 1);
        }
      });
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
