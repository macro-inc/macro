import { createUrqlInfiniteQuery, createUrqlQuery } from '@app/lib/urql-solid';
import { fireAndForget } from '@core/util/fireAndForget';
import { Telemetry } from '@macro-inc/observability';
import type { OperationResult } from '@urql/core';
import {
  type Accessor,
  batch,
  createComputed,
  createEffect,
  createMemo,
  createRoot,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';
import { normalizedCacheResultMetadata } from '../../../graphql-cache/exchange/normalized-cache-exchange';
import { selectRecords } from '../../../graphql-cache/exchange/record-selection';
import {
  type GroupedSoupInput,
  GroupSoupDocument,
  type GroupSoupQuery,
  type GroupSoupQueryVariables,
  type SoupItemFieldsFragment,
  SoupItemFieldsFragmentDoc,
} from '../../../service-clients/service-storage/graphql/generated/graphql';
import {
  getGraphqlSoupCacheHost,
  getGraphqlSoupClient,
} from '../../../service-clients/service-storage/graphql-soup';
import { registerGroupedSoupContinuation } from '../grouped/graphql-operation-registry';
import { registerGraphqlSoupRevalidations } from './active-queries';
import { createPredicateQuery } from './create-predicate-query';
import {
  mergeGroupedSoupBins,
  projectLocalGroupedSoup,
} from './grouped-local-projection';
import { createGroupedPageEvidence } from './grouped-page-evidence';
import { soupItemKey, soupReconciliationBaseline } from './reconciliation';

/** Paging capabilities; rows for all loaded groups are owned by the parent source. */
export type GroupedSoupPaging = {
  hasNextPage(key: string): boolean;
  isFetchingNextPage(key: string): boolean;
  error(key: string): Error | null;
  fetchNextPage(key: string): Promise<void>;
  resetToInitialPage(): void;
};

type Options = {
  enabled: boolean;
  networkPaused?: boolean;
  keepPreviousData?: boolean;
  onInitialResult(
    result: OperationResult<GroupSoupQuery, GroupSoupQueryVariables>
  ): void;
};

/** One owner for grouped server pages and their maintained local membership. */
export function createGroupedSoupLiveQuery(
  input: Accessor<GroupedSoupInput | undefined>,
  options: Accessor<Options>,
  now: Accessor<Date>
) {
  const [generation, setGeneration] = createSignal(0);
  let previousHost = getGraphqlSoupCacheHost();
  createEffect(
    on(getGraphqlSoupCacheHost, (host) => {
      if (host !== previousHost) setGeneration((value) => value + 1);
      previousHost = host;
      if (host)
        onCleanup(
          host.onCacheGenerationChanged(() =>
            setGeneration((value) => value + 1)
          )
        );
    })
  );
  const scope = () => JSON.stringify([input(), generation()]);
  const initialEvidence = createGroupedPageEvidence(scope);
  let initialResultScope: string | undefined;
  let refreshContinuations = (_data: GroupSoupQuery) => {};
  const query = createUrqlQuery<
    GroupSoupQuery,
    GroupSoupQueryVariables,
    { inputKey: string; data: GroupSoupQuery }
  >(() => {
    const queryInput = input();
    const requestScope = scope();
    const queryOptions = options();
    const common = {
      query: GroupSoupDocument,
      client: getGraphqlSoupClient(),
      requestPolicy: queryOptions.networkPaused
        ? ('cache-only' as const)
        : ('cache-and-network' as const),
      keepPreviousData: queryOptions.keepPreviousData ?? false,
      onResult: (
        result: OperationResult<GroupSoupQuery, GroupSoupQueryVariables>
      ) => {
        if (scope() !== requestScope) return;
        if (result.data && !result.error && !result.hasNext) {
          const resultScope = JSON.stringify([
            requestScope,
            result.data.user.id,
          ]);
          // Auto-pagination can start during the query's first data emission,
          // before onResult runs. That first response has no old chain to refresh.
          if (
            initialResultScope === resultScope &&
            normalizedCacheResultMetadata(result)?.source === 'live-network'
          )
            refreshContinuations(result.data);
          initialResultScope = resultScope;
        }
        initialEvidence.accept(result, 0, requestScope);
        queryOptions.onInitialResult(result);
      },
      select: (data: GroupSoupQuery) => ({
        inputKey: JSON.stringify(queryInput),
        data,
      }),
    };
    return queryOptions.enabled && queryInput
      ? { ...common, variables: { input: queryInput }, enabled: true }
      : { ...common, enabled: false as const };
  });
  const currentInitial = () => {
    const initial = query.data;
    return initial?.inputKey === JSON.stringify(input())
      ? initial?.data
      : undefined;
  };
  const continuationScope = () =>
    JSON.stringify([scope(), currentInitial()?.user.id]);

  const createContinuation = (
    key: string,
    cursor: string,
    initial: GroupedSoupInput,
    refresh = false
  ) =>
    createRoot((dispose) => {
      const requestScope = continuationScope();
      const evidence = createGroupedPageEvidence(continuationScope);
      const [activated, setActivated] = createSignal(false);
      const continuationInput = (cursor: string): GroupedSoupInput => ({
        continuation: {
          cursor,
          groupKey: key,
          groupBy: (initial.initial ?? initial.continuation).groupBy,
        },
      });
      let settle = () => {};
      const settled = new Promise<void>((resolve) => {
        settle = resolve;
      });
      const continued = createUrqlInfiniteQuery<
        GroupSoupQuery,
        GroupSoupQueryVariables,
        string,
        { pages: Accessor<GroupSoupQuery[]>; pageParams: readonly string[] }
      >(() => ({
        query: GroupSoupDocument,
        client: getGraphqlSoupClient(),
        initialPageParam: cursor,
        variables: (cursor) => {
          const pageInput = continuationInput(cursor);
          registerGroupedSoupContinuation(initial, pageInput);
          return { input: pageInput };
        },
        enabled:
          activated() &&
          options().enabled &&
          continuationScope() === requestScope,
        requestPolicy: options().networkPaused
          ? 'cache-only'
          : refresh
            ? 'network-only'
            : 'cache-first',
        keepPreviousData: false,
        getNextPageParam: (page) =>
          page.user.groupSoup.bins.find((bin) => bin.key === key)?.nextCursor ??
          undefined,
        onResult: (result, page) =>
          evidence.accept(result, page.pageIndex, requestScope),
        select: ({ pages, pageParams }) => ({ pages: () => pages, pageParams }),
      }));
      onCleanup(
        registerGraphqlSoupRevalidations(() =>
          continued.isEnabled
            ? [...new Set([cursor, ...(continued.data?.pageParams ?? [])])].map(
                (cursor) => ({
                  document: GroupSoupDocument,
                  variables: { input: continuationInput(cursor) },
                })
              )
            : []
        )
      );
      createComputed(() => {
        if (
          activated() &&
          (!continued.isEnabled ||
            (continued.isFetched && !continued.isFetching))
        )
          settle();
      });
      onCleanup(settle);
      return {
        query: continued,
        evidence,
        dispose,
        activate: async () => {
          setActivated(true);
          await settled;
        },
      };
    });
  const [continuations, setContinuations] = createSignal<
    ReadonlyMap<string, ReturnType<typeof createContinuation>>
  >(new Map());
  type Refresh = {
    continuation: ReturnType<typeof createContinuation>;
    done: Promise<void>;
  };
  const [refreshes, setRefreshes] = createSignal<ReadonlyMap<string, Refresh>>(
    new Map()
  );
  const [refreshErrors, setRefreshErrors] = createSignal<
    ReadonlyMap<string, Error>
  >(new Map());
  const cancelRefresh = (key: string) => {
    const refresh = refreshes().get(key);
    if (!refresh) return;
    setRefreshes((previous) => {
      const remaining = new Map(previous);
      remaining.delete(key);
      return remaining;
    });
    refresh.continuation.dispose();
  };
  const resetContinuations = () => {
    for (const key of refreshes().keys()) cancelRefresh(key);
    for (const continuation of continuations().values()) continuation.dispose();
    setContinuations(new Map());
    setRefreshErrors(new Map());
  };

  // Rebuild from the new cursor without exposing a partially loaded chain.
  // The previous owner remains live until every previously loaded page is ready.
  async function replaceContinuation(
    key: string,
    previous: ReturnType<typeof createContinuation>,
    refresh: Refresh
  ) {
    const replacement = refresh.continuation;
    const current = () =>
      refreshes().get(key) === refresh && continuations().get(key) === previous;
    const span = Telemetry.span('graphql_cache.soup_grouped_refresh');
    span.setAttr('grouping.refresh_outcome', 'cancelled');
    return span.run(async () => {
      try {
        // A load-more already in flight can extend the visible chain. Paging
        // is gated by refreshes while we wait, so its settled depth is final.
        if (!previous.query.isFetched) await previous.activate();
        if (previous.query.isFetchingNextPage)
          await previous.query.fetchNextPage();
        if (!current()) return;
        const pageCount = Math.max(1, previous.query.data?.pages().length ?? 0);
        span.setAttr('grouping.page_count', pageCount);
        await replacement.activate();
        if (!current()) return;
        if (replacement.query.error) throw replacement.query.error;
        for (let page = 1; page < pageCount; page += 1) {
          if (!replacement.query.hasNextPage) break;
          await replacement.query.fetchNextPage({ throwOnError: true });
          if (!current()) return;
        }
        if (!replacement.query.data || !replacement.query.isEnabled) return;
        batch(() => {
          setContinuations((owners) => new Map(owners).set(key, replacement));
          previous.dispose();
        });
        span.setAttr('grouping.refresh_outcome', 'replaced');
      } catch (cause) {
        if (!current()) return;
        const error = cause instanceof Error ? cause : new Error(String(cause));
        setRefreshErrors((errors) => new Map(errors).set(key, error));
        span.setAttr('grouping.refresh_outcome', 'failed');
        span.error(error.message);
        throw error;
      } finally {
        if (continuations().get(key) !== replacement) replacement.dispose();
        if (refreshes().get(key) === refresh) {
          setRefreshes((previous) => {
            const remaining = new Map(previous);
            remaining.delete(key);
            return remaining;
          });
        }
        span.end();
      }
    });
  }
  refreshContinuations = (data) => {
    const initial = input();
    if (!initial || !options().enabled || options().networkPaused) return;
    setRefreshErrors(new Map());
    for (const [key, previous] of continuations()) {
      cancelRefresh(key);
      const cursor = data.user.groupSoup.bins.find(
        (bin) => bin.key === key
      )?.nextCursor;
      if (!cursor) {
        setContinuations((owners) => {
          const remaining = new Map(owners);
          remaining.delete(key);
          return remaining;
        });
        previous.dispose();
        continue;
      }
      const refresh = {
        continuation: createContinuation(key, cursor, initial, true),
        done: Promise.resolve(),
      };
      setRefreshes((previous) => new Map(previous).set(key, refresh));
      refresh.done = replaceContinuation(key, previous, refresh);
      fireAndForget(refresh.done, 'soup-grouped-refresh');
    }
  };
  createComputed(on(continuationScope, () => resetContinuations()));
  createComputed(
    on(
      () => currentInitial()?.user.groupSoup.bins.map((bin) => bin.key) ?? [],
      (keys) => {
        const active = new Set(keys);
        const remaining = new Map(continuations());
        for (const [key, continuation] of remaining) {
          if (active.has(key)) continue;
          cancelRefresh(key);
          continuation.dispose();
          remaining.delete(key);
        }
        if (remaining.size !== continuations().size)
          setContinuations(remaining);
      }
    )
  );
  onCleanup(resetContinuations);

  const serverPages = createMemo(() => {
    const initial = currentInitial();
    if (!initial) return [];
    return [
      initial,
      ...[...continuations().values()].flatMap(
        (continuation) => continuation.query.data?.pages() ?? []
      ),
    ].filter((page) => page.user.id === initial.user.id);
  });
  const baseline = createMemo(() => {
    const initial = initialEvidence.data();
    if (
      !initial ||
      !currentInitial() ||
      initial[0].user.id !== currentInitial()?.user.id
    )
      return undefined;
    const pages = [...initial];
    const untrustedKeys = initialEvidence.untrustedKeys();
    for (const continuation of continuations().values()) {
      const loaded = continuation.query.data?.pages();
      if (!loaded?.length) continue;
      const evidence = continuation.evidence.data();
      if (!evidence || evidence.length !== loaded.length) return undefined;
      pages.push(...evidence);
      for (const key of continuation.evidence.untrustedKeys())
        untrustedKeys.add(key);
    }
    return {
      bins: mergeGroupedSoupBins(
        pages.filter((page) => page.user.id === initial[0].user.id)
      ),
      untrustedKeys,
    };
  });
  const selection = selectRecords(SoupItemFieldsFragmentDoc);
  const live = createPredicateQuery<SoupItemFieldsFragment>({
    host: getGraphqlSoupCacheHost,
    query: () => {
      const initial = input()?.initial;
      const bins = baseline();
      if (
        !options().enabled ||
        !getGraphqlSoupCacheHost()?.liveQueries ||
        !initial ||
        !bins ||
        (initial.sortMethod !== 'CREATED_AT' &&
          initial.sortMethod !== 'UPDATED_AT')
      )
        return undefined;
      const membership = soupReconciliationBaseline(
        bins.bins.flatMap((bin) => bin.items),
        initial.sortMethod
      );
      if (!membership) return undefined;
      return {
        source: {
          filters: initial.filters ?? {},
          sortMethod: initial.sortMethod,
          sortDirection: 'DESC',
          limit: initial.limit ?? 20,
          baseline: membership,
        },
        select: selection,
      };
    },
  });
  const bins = createMemo(() => {
    const initial = input()?.initial;
    const evidence = baseline();
    const snapshot = live.data();
    if (!initial || !evidence || !snapshot || live.status() !== 'ready')
      return mergeGroupedSoupBins(serverPages());
    const span = Telemetry.span('graphql_cache.soup_grouped_local_evaluation');
    try {
      const currentItems = new Map<string, SoupItemFieldsFragment>();
      for (const page of serverPages())
        for (const bin of page.user.groupSoup.bins)
          for (const item of bin.items)
            currentItems.set(soupItemKey(item), item);
      const result = projectLocalGroupedSoup(
        evidence.bins,
        currentItems,
        snapshot,
        initial,
        now(),
        evidence.untrustedKeys
      );
      span.setAttr('grouping.field', initial.groupBy.field);
      span.setAttr('grouping.bin_count', result.length);
      span.setAttr(
        'grouping.baseline_count',
        evidence.bins.reduce((count, bin) => count + bin.items.length, 0)
      );
      return result;
    } finally {
      span.end();
    }
  });
  const paging: GroupedSoupPaging = {
    hasNextPage: (key) => {
      const continuation = continuations().get(key);
      return continuation?.query.data
        ? continuation.query.hasNextPage
        : Boolean(bins().find((bin) => bin.key === key)?.nextCursor);
    },
    isFetchingNextPage: (key) =>
      refreshes().has(key) ||
      (continuations().get(key)?.query.isFetching ?? false),
    error: (key) =>
      refreshErrors().get(key) ?? continuations().get(key)?.query.error ?? null,
    fetchNextPage: async (key) => {
      const initial = input();
      if (!initial || !options().enabled) return;
      const refresh = refreshes().get(key);
      if (refresh) {
        await refresh.done;
        return;
      }
      const current = continuations().get(key);
      if (current) {
        if (current.query.isFetching) return;
        if (!current.query.data) await current.query.refetch();
        else await current.query.fetchNextPage();
        return;
      }
      const cursor = bins().find((bin) => bin.key === key)?.nextCursor;
      if (!cursor) return;
      const continuation = createContinuation(key, cursor, initial);
      setContinuations((previous) => new Map(previous).set(key, continuation));
      await continuation.activate();
    },
    resetToInitialPage: () => resetContinuations(),
  };
  return {
    query,
    paging,
    refresh: async () => {
      const requestScope = continuationScope();
      await query.refetch({
        requestPolicy: 'network-only',
        throwOnError: true,
      });
      while (continuationScope() === requestScope && refreshes().size) {
        await Promise.all(
          [...refreshes().values()].map((refresh) => refresh.done)
        );
      }
      if (continuationScope() !== requestScope) return;
      const error = refreshErrors().values().next().value;
      if (error) throw error;
    },
    data: createMemo((): GroupSoupQuery | undefined => {
      const initial = currentInitial();
      if (!initial) return query.data?.data;
      return {
        ...initial,
        user: {
          ...initial.user,
          groupSoup: { ...initial.user.groupSoup, bins: bins() },
        },
      };
    }),
  };
}
