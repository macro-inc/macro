import type { ListDataSource } from '@app/components/list';
import type { MarkDoneDelegate } from '@app/features/next-soup/actions/mark-done-delegate';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  createSoupRowStore,
  type SoupRow,
  useSearchContext,
} from '@app/features/soup';
import {
  getEntityNotifications,
  withEntityNotifications,
} from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  enableCalendarUi,
  enableGraphqlSoup,
  enableInboxNotifiedSort,
  enableSnippets,
  enableSupportedSoupForeignEntities,
  isFeatureEnabled,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import {
  type EntityData,
  isSnippetEntity,
  type WithNotification,
} from '@entity';
import { unreadFilterFn } from '@entity/utils/filter';
import type { UnifiedNotification } from '@notifications/types';
import {
  type SoupApiItemFilter,
  useSoupAstItemsQuery,
} from '@queries/soup/items';
import { startOfDay, subWeeks } from 'date-fns';
import {
  type Accessor,
  createMemo,
  createSignal,
  onCleanup,
  onMount,
} from 'solid-js';
import { match } from 'ts-pattern';
import {
  noiseFilter,
  signalFilter,
} from '../../next-soup/filters/inbox-filters';
import type { HomeFacetContext } from '../home-facets';
import type { HomeTab, HomeViewState } from '../types';
import { useWorkFeedHomeDataSource } from '../work-feed/home-work-feed';
import {
  admitHomeEntities,
  emptyHomeAdmission,
  type HomeAdmission,
} from './home-admission';
import { homeClock, homeTimestamp } from './home-date-buckets';
import { soupItemMatchesHomeTab } from './home-item-filter';
import { getHomePagination } from './home-pagination';
import {
  buildHomeQuery,
  type HomeQueryCapabilities,
  type HomeViewContext,
} from './home-query';
import {
  groupHomeEntitiesByDate,
  groupHomeEntitiesByTabDate,
  homeSortTimestamp,
  mergeHomeEntities,
} from './home-results';
import { buildHomeSearchRequest } from './home-search';

export type HomeDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type HomeDataSource = ListDataSource<HomeDataSourceItem> & {
  warning: () => string | undefined;
};

export type HomeDataSourceInput = Pick<
  HomeViewState,
  'tab' | 'search' | 'groupBy' | 'facets'
>;

function matchesCapabilities(
  entity: EntityData,
  capabilities: HomeQueryCapabilities
): boolean {
  if (entity.type === 'calendar_event') return capabilities.calendar;
  if (entity.type === 'foreign') return capabilities.foreignEntities;
  if (isSnippetEntity(entity)) return capabilities.snippets;

  return true;
}

function matchesTab(
  entity: EntityData,
  tab: HomeTab,
  notifications: () => UnifiedNotification[]
): boolean {
  const notDone = () =>
    entity.type === 'email'
      ? !entity.done
      : notifications().some((notification) => notification.state !== 'done');
  return match(tab)
    .with('signal', () => {
      if (!signalFilter(entity) || !notDone()) return false;

      if (
        entity.type !== 'document' &&
        entity.type !== 'email' &&
        entity.type !== 'chat' &&
        entity.type !== 'project'
      ) {
        return true;
      }

      return (
        new Date(homeSortTimestamp(entity) ?? 0).getTime() >=
        subWeeks(startOfDay(new Date()), 2).getTime()
      );
    })
    .with('noise', () => noiseFilter(entity) && notDone())
    .exhaustive();
}

// Cached query meta outlives the view; build the gate at module scope over the
// plain tab value so it cannot retain this hook's scope.
function homeTabInsertFilter(tab: HomeTab): SoupApiItemFilter {
  return (item) => soupItemMatchesHomeTab(item, tab);
}

/** Shared feed membership for the Home list and its sidebar unread indicator. */
export function useHomeEntitiesQuery(
  state: Pick<HomeDataSourceInput, 'tab' | 'facets'>,
  options: { enabled?: () => boolean } = {}
) {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const foreignEntities = useFeatureFlag(enableSupportedSoupForeignEntities);
  const notifiedSort = useFeatureFlag(enableInboxNotifiedSort);

  const facetContext = (): HomeFacetContext => ({ notificationSource });

  const capabilities = (): HomeQueryCapabilities => ({
    calendar: isFeatureEnabled(enableCalendarUi),
    foreignEntities: foreignEntities().enabled,
    notifiedSort: notifiedSort().enabled,
    snippets: isFeatureEnabled(enableSnippets),
  });

  const viewContext = createMemo(
    (): HomeViewContext => ({
      tab: state.tab,
      facets: state.facets,
      facetContext: facetContext(),
      capabilities: capabilities(),
      userId: userId(),
    })
  );

  const queryArgs = createMemo(() => buildHomeQuery(viewContext()));

  const query = useSoupAstItemsQuery(queryArgs, () => {
    // Capture the tab alongside the query args so the insert gate stays bound
    // to the query it was registered on: after a tab switch the previous
    // tab's cached query keeps gating cache inserts by its own membership.
    const tab = viewContext().tab;
    return {
      enabled: options.enabled?.() ?? true,
      showSupportedForeignEntities: foreignEntities().enabled,
      meta: {
        insertFilter: homeTabInsertFilter(tab),
      },
    };
  });

  const scopedNotifications = (entity: EntityData) =>
    getEntityNotifications(entity, notificationSource, {
      scopeChannelThreads: true,
    });
  const filterEntities = (entities: EntityData[]) => {
    const context = viewContext();
    return entities
      .filter((entity) => matchesCapabilities(entity, context.capabilities))
      .filter((entity) =>
        matchesTab(entity, context.tab, () => scopedNotifications(entity))
      );
  };

  /** Badge presence: stop at the first match without transforming the page. */
  const hasUnreadEntity = (entities: readonly EntityData[]): boolean => {
    const context = viewContext();
    return entities.some((entity) => {
      if (!matchesCapabilities(entity, context.capabilities)) return false;
      // Cache only within this visit. Membership and unread checks share the
      // same scoped snapshot, but later calls still observe optimistic changes.
      let snapshot: UnifiedNotification[] | undefined;
      const notifications = () => (snapshot ??= scopedNotifications(entity));
      if (!matchesTab(entity, context.tab, notifications)) return false;
      return unreadFilterFn({ ...entity, notifications });
    });
  };

  const attachNotifications = (entity: EntityData) =>
    withEntityNotifications(entity, notificationSource, {
      scopeChannelThreads: true,
    });
  const transformEntities = (entities: EntityData[]) =>
    filterEntities(entities).map(attachNotifications);

  return {
    query,
    viewContext,
    filterEntities,
    attachNotifications,
    transformEntities,
    hasUnreadEntity,
    notificationSource,
  };
}

export type HomeListDataSource = HomeDataSource & {
  /** Set when Home's rows complete as work feed items. */
  markDoneDelegate: Accessor<MarkDoneDelegate | undefined>;
};

/**
 * Home's list. Desktop Signal reads the server work feed wherever GraphQL
 * Soup is on, since the feed's live changes ride its websocket and cache;
 * every other view (Noise, touch devices, search) merges Soup, notification
 * and recent-activity sources on the client.
 */
export function useHomeDataSource(
  state: HomeDataSourceInput
): HomeListDataSource {
  const graphqlSoup = useFeatureFlag(enableGraphqlSoup);
  const usesWorkFeed = () =>
    graphqlSoup().enabled &&
    state.tab === 'signal' &&
    !isTouchDevice() &&
    !state.search.trim();

  const soup = useSoupHomeDataSource(state, {
    enabled: () => !usesWorkFeed(),
  });
  const workFeed = useWorkFeedHomeDataSource(state, { enabled: usesWorkFeed });
  const active = (): HomeDataSource => (usesWorkFeed() ? workFeed : soup);

  return {
    items: () => active().items(),
    isLoading: () => active().isLoading(),
    isFetching: () => active().isFetching(),
    error: () => active().error(),
    warning: () => active().warning(),
    hasMore: () => active().hasMore(),
    isLoadingMore: () => active().isLoadingMore(),
    loadMore: () => active().loadMore(),
    refresh: () => active().refresh(),
    markDoneDelegate: () =>
      usesWorkFeed() ? workFeed.markDoneDelegate() : undefined,
  };
}

function useSoupHomeDataSource(
  state: HomeDataSourceInput,
  options: { enabled: () => boolean }
): HomeDataSource {
  const {
    query,
    viewContext,
    filterEntities,
    attachNotifications,
    transformEntities,
  } = useHomeEntitiesQuery(state, options);

  const [now, setNow] = createSignal(homeClock());
  onMount(() => {
    const timer = setInterval(() => setNow(homeClock()), 30_000);
    onCleanup(() => clearInterval(timer));
  });

  // Only desktop Home merges the viewer's own recents into Signal; touch
  // devices keep Signal a pure notification feed, like the legacy
  // Notifications view.
  const mergeRecents = () =>
    options.enabled() && state.tab === 'signal' && !isTouchDevice();

  // Activity's hydrated own-touch projection includes sent mail and chats even
  // when they have no outstanding notifications. Its endpoint rejects email
  // and channel filter trees, so Home applies its facets after merging.
  const recentQuery = useSoupAstItemsQuery(
    () => ({
      params: {
        expand: true,
        limit: 100,
        sort_method: 'touched_by_me',
        sort_direction: 'desc',
      },
      body: {},
    }),
    () => ({ enabled: mergeRecents() })
  );
  const recentEntities = () =>
    mergeRecents() && !recentQuery.isLoading
      ? (recentQuery.data?.entities ?? [])
      : [];
  const transformHomeEntities = (entities: EntityData[], recents = entities) =>
    mergeRecents()
      ? mergeHomeEntities(
          filterEntities(entities),
          recents.filter((entity) =>
            matchesCapabilities(entity, viewContext().capabilities)
          ),
          viewContext()
        ).map((entity) => ({
          ...attachNotifications(entity),
          notificationDisplayCutoff: entity.sortTs,
        }))
      : transformEntities(entities);

  const { entityPool } = useSearchContext();
  const localPool = createMemo(() => {
    if (!state.search.trim()) return [];
    const pool = entityPool();
    const matchingIds = new Set(
      transformHomeEntities(pool.map((item) => item.data)).map(
        (entity) => entity.id
      )
    );
    return pool.filter((item) => matchingIds.has(item.data.id));
  });

  const search = createSearchState({
    text: () => state.search,
    localPool,
    buildRequest: (request) => buildHomeSearchRequest(viewContext(), request),
  });

  const rawEntities = createMemo<EntityData[]>((previous) => {
    if (!search.isSearching()) {
      const notifications = query.isLoading ? [] : (query.data?.entities ?? []);
      return notifications;
    }

    const results = search.data();
    if (
      results.length === 0 &&
      previous.length > 0 &&
      search.isLocalSearchSettling()
    ) {
      return previous;
    }
    return results;
  }, []);

  const homePagination = createMemo(() => {
    if (!mergeRecents() || search.isSearching()) return undefined;
    return getHomePagination(
      {
        oldestFetchedTimestamp: query.isLoading
          ? undefined
          : query.data?.oldestFetchedTimestamp,
        hasMore: query.hasNextPage && !query.error,
        isLoading: query.isLoading,
      },
      {
        oldestFetchedTimestamp: recentQuery.isLoading
          ? undefined
          : recentQuery.data?.oldestFetchedTimestamp,
        hasMore: recentQuery.hasNextPage && !recentQuery.error,
        isLoading: recentQuery.isLoading,
      }
    );
  });

  const entities = createMemo<HomeAdmission>((previous) => {
    const context = viewContext();
    const cutoff = homePagination()?.cutoff ?? -Infinity;
    return admitHomeEntities(previous, {
      entities: transformHomeEntities(
        rawEntities(),
        search.isSearching() ? rawEntities() : recentEntities()
      ).filter(
        (entity) =>
          cutoff === -Infinity ||
          (homeTimestamp(entity.sortTs) ?? -Infinity) > cutoff
      ),
      tab: context.tab,
      facets: context.facets,
      facetContext: context.facetContext,
    });
  }, emptyHomeAdmission());

  const usesServiceSearch = search.usesServiceSearch;
  const hasNoTypes = () =>
    state.facets.type?.length === 1 && state.facets.type[0] === 'none';

  const hasMore = () => {
    if (hasNoTypes()) return false;
    if (usesServiceSearch()) return search.hasNextPage();
    return (
      (query.hasNextPage && !query.error) ||
      (mergeRecents() && recentQuery.hasNextPage && !recentQuery.error)
    );
  };

  const isLoadingMore = () => {
    if (usesServiceSearch()) return search.isFetchingNextPage();
    return (
      query.isFetchingNextPage ||
      (mergeRecents() && recentQuery.isFetchingNextPage)
    );
  };

  const builtItems = createMemo<HomeDataSourceItem[]>(() => {
    let result: HomeDataSourceItem[];
    if (state.groupBy === 'date' && !search.isSearching()) {
      result = buildGroupedSoupRows(
        mergeRecents()
          ? groupHomeEntitiesByDate(entities().items, new Date(now()))
          : groupHomeEntitiesByTabDate(entities().items, viewContext())
      );
    } else {
      result = buildFlatSoupRows(entities().items);
    }

    return result;
  });
  const items = createSoupRowStore(builtItems);

  const isLoading = () => {
    if (hasNoTypes()) return false;
    if (!search.isSearching()) {
      return (
        (query.isLoading || (mergeRecents() && recentQuery.isLoading)) &&
        entities().items.length === 0
      );
    }
    if (entities().items.length > 0) return false;
    if (usesServiceSearch()) return search.isLoading();
    return query.isLoading;
  };

  return {
    items,
    isLoading,
    isFetching: () => {
      if (search.isSettling()) return true;
      return usesServiceSearch()
        ? search.isFetching()
        : query.isFetching || (mergeRecents() && recentQuery.isFetching);
    },
    error: () => {
      if (hasNoTypes()) return undefined;
      if (!usesServiceSearch())
        return entities().items.length === 0 && !hasMore()
          ? (query.error ??
              (mergeRecents() ? recentQuery.error : undefined) ??
              undefined)
          : undefined;
      return search.error();
    },
    warning: () => {
      if (usesServiceSearch() || (entities().items.length === 0 && !hasMore()))
        return undefined;
      if (query.error) return 'Notifications could not be refreshed.';
      if (mergeRecents() && recentQuery.error)
        return 'Recent activity could not be refreshed.';
      return undefined;
    },
    hasMore,
    isLoadingMore,
    loadMore: async () => {
      if (hasNoTypes()) return;
      if (usesServiceSearch()) {
        await search.fetchNextPage();
        return;
      }
      const pagination = homePagination();
      await Promise.all([
        query.hasNextPage &&
        !query.error &&
        (pagination?.loadNotifications ?? true)
          ? query.fetchNextPage()
          : undefined,
        mergeRecents() &&
        recentQuery.hasNextPage &&
        !recentQuery.error &&
        (pagination?.loadActivity ?? true)
          ? recentQuery.fetchNextPage()
          : undefined,
      ]);
    },
    refresh: async () => {
      if (usesServiceSearch()) {
        await search.refetch();
        return;
      }
      await Promise.all([
        query.refresh(),
        mergeRecents() ? recentQuery.refresh() : undefined,
      ]);
    },
  } satisfies HomeDataSource;
}
