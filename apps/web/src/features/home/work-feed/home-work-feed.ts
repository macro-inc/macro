import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSoupRowStore,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  enableCalendarUi,
  enableSnippets,
  enableSupportedSoupForeignEntities,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { revalidateNotificationReaders } from '@queries/notification/revalidation';
import {
  getGraphqlCacheHost,
  getGraphqlSoupClient,
  subscribeGraphqlSoupReconnected,
} from '@service-storage/graphql-soup';
import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import type { HomeFacetContext } from '../home-facets';
import {
  admitHomeEntities,
  emptyHomeAdmission,
  type HomeAdmission,
} from '../queries/home-admission';
import { homeClock } from '../queries/home-date-buckets';
import { groupHomeEntitiesByDate } from '../queries/home-results';
import type {
  HomeDataSource,
  HomeDataSourceItem,
} from '../queries/use-home-query';
import type { HomeViewState } from '../types';
import { type WorkFeedScope, workFeedEntityKey } from './core/work-feed';
import { homeWorkFeedPageState, homeWorkFeedScope } from './home-scope';
import { createWorkFeed } from './primitives/work-feed';

/** Scope sent when the type filters leave nothing to show; never fetched. */
const EMPTY_SCOPE: WorkFeedScope = {
  mode: 'work',
  types: [],
  includeSnippets: false,
};

export type WorkFeedHomeDataSource = HomeDataSource & {
  /** Completes Home rows as work feed items. */
  markDoneDelegate: Accessor<MarkDoneDelegate | undefined>;
};

/**
 * Desktop Home Signal backed by the server work feed: one cursor over
 * attention and own work, server-stacked notifications, live changes
 * written into the cached pages, and item-level done. The type and read
 * facets narrow pages server-side; the read facet also runs client-side,
 * where Home's admission keeps a row that turns read while shown.
 */
export function useWorkFeedHomeDataSource(
  state: Pick<HomeViewState, 'tab' | 'groupBy' | 'facets'>,
  options: { enabled: Accessor<boolean> }
): WorkFeedHomeDataSource {
  const notificationSource = useGlobalNotificationSource();
  const foreignEntities = useFeatureFlag(enableSupportedSoupForeignEntities);

  const scope = createMemo(() =>
    homeWorkFeedScope(state.facets.type, {
      calendar: isFeatureEnabled(enableCalendarUi),
      foreignEntities: foreignEntities().enabled,
      snippets: isFeatureEnabled(enableSnippets),
    })
  );
  const hasScope = () => scope() !== undefined;
  const enabled = () => options.enabled() && hasScope();

  const feed = createWorkFeed({
    client: () => getGraphqlSoupClient(),
    cacheHost: getGraphqlCacheHost,
    scope: () => scope() ?? EMPTY_SCOPE,
    state: () => homeWorkFeedPageState(state.facets.read),
    enabled,
    onReconnected: subscribeGraphqlSoupReconnected,
    revalidateNotifications: revalidateNotificationReaders,
  });

  const [now, setNow] = createSignal(homeClock());
  onMount(() => {
    const timer = setInterval(() => setNow(homeClock()), 30_000);
    onCleanup(() => clearInterval(timer));
  });

  const facetContext = (): HomeFacetContext => ({ notificationSource });
  // The server filtered pages by this state; admitting by the same state
  // keeps the read facet from dropping rows the server and the
  // notifications disagree on, such as an unseen channel invite.
  const unseen = createMemo(
    () =>
      new Set(
        feed
          .entries()
          .filter((entry) => entry.state === 'unseen')
          .map((entry) => workFeedEntityKey(entry.entity))
      )
  );
  const entities = createMemo<HomeAdmission>(
    (previous) =>
      admitHomeEntities(previous, {
        // The server scoped each row's notifications to its item; the
        // shared source still layers local seen/done overrides on top.
        entities: enabled()
          ? feed
              .entries()
              .map((entry) =>
                withEntityNotifications(entry.entity, notificationSource)
              )
          : [],
        tab: state.tab,
        facets: state.facets,
        facetContext: facetContext(),
        isUnread: (entity) => unseen().has(workFeedEntityKey(entity)),
      }),
    emptyHomeAdmission()
  );

  const builtItems = createMemo<HomeDataSourceItem[]>(() =>
    state.groupBy === 'date'
      ? buildGroupedSoupRows(
          groupHomeEntitiesByDate(entities().items, new Date(now()))
        )
      : buildFlatSoupRows(entities().items)
  );
  const items = createSoupRowStore(builtItems);

  const hasMore = () =>
    enabled() && feed.query.hasNextPage && !feed.query.error;

  return {
    items,
    // A filter change keeps the previous pages until the new ones arrive;
    // while none of their rows pass the new filter, the list is loading,
    // not empty.
    isLoading: () =>
      enabled() && feed.query.isFetching && entities().items.length === 0,
    isFetching: () => enabled() && feed.query.isFetching,
    isLoadingMore: () => enabled() && feed.query.isFetchingNextPage,
    hasMore,
    error: () =>
      enabled() && entities().items.length === 0 && !hasMore()
        ? (feed.query.error ?? undefined)
        : undefined,
    warning: () =>
      enabled() && feed.query.error && entities().items.length > 0
        ? 'Home could not be refreshed.'
        : undefined,
    loadMore: async () => {
      if (!hasMore()) return;
      await feed.query.fetchNextPage();
    },
    refresh: async () => {
      if (!enabled()) return;
      await feed.refetch();
    },
    markDoneDelegate: () => (enabled() ? feed.markDone : undefined),
  };
}
