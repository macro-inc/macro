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
import type { FacetSelection } from '@app/features/soup/filters/facets/types';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  enableInboxNotifiedSort,
  enableSupportedSoupForeignEntities,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import type { EntityData, WithNotification } from '@entity';
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
import { searchListedHomeEntities } from './home-listed-search';
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
  if (entity.type === 'foreign') return capabilities.foreignEntities;

  return true;
}

function matchesTab(
  entity: EntityData,
  tab: HomeTab,
  notifications: () => UnifiedNotification[],
  searching: boolean
): boolean {
  const notDone = () =>
    entity.type === 'email'
      ? !entity.done
      : notifications().some((notification) => notification.state !== 'done');
  return (
    match(tab)
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
      // The viewer's own activity: cache inserts from other users carry no
      // touch, and only server-classified Signal mail enters, as in Home's
      // merged recents. A search finds beyond it, as Home's search does:
      // its service hits carry no touch.
      .with(
        'recent',
        () =>
          searching ||
          (homeTimestamp(entity.touchedAt) !== undefined &&
            (entity.type !== 'email' || entity.isSignal === true))
      )
      .exhaustive(() => false)
  );
}

function withoutStatus(facets: FacetSelection): FacetSelection {
  const { read: _read, ...rest } = facets;
  return rest;
}

// Cached query meta outlives the view; build the gate at module scope over the
// plain tab value so it cannot retain this hook's scope.
function homeTabInsertFilter(tab: HomeTab): SoupApiItemFilter {
  return (item) => soupItemMatchesHomeTab(item, tab);
}

/** Shared feed membership for the Home list and its sidebar unread indicator. */
export function useHomeEntitiesQuery(
  state: Pick<HomeDataSourceInput, 'tab' | 'facets'> & { search?: string },
  options: { enabled?: () => boolean } = {}
) {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const foreignEntities = useFeatureFlag(enableSupportedSoupForeignEntities);
  const notifiedSort = useFeatureFlag(enableInboxNotifiedSort);

  const facetContext = (): HomeFacetContext => ({ notificationSource });

  const capabilities = (): HomeQueryCapabilities => ({
    foreignEntities: foreignEntities().enabled,
    notifiedSort: notifiedSort().enabled,
  });

  const viewContext = createMemo(
    (): HomeViewContext => ({
      tab: state.tab,
      // Recent has no Status filter; old Home's saved one doesn't apply.
      facets:
        state.tab === 'recent' ? withoutStatus(state.facets) : state.facets,
      facetContext: facetContext(),
      capabilities: capabilities(),
      userId: userId(),
    })
  );

  const queryArgs = createMemo(() => buildHomeQuery(viewContext()));

  const requested = () => options.enabled?.() ?? true;
  // Signal's channel threads are the viewer's own, so wait for the viewer
  // like the Channels thread queries instead of fetching a page to discard.
  const awaitingViewer = () => requested() && !userId();

  const query = useSoupAstItemsQuery(queryArgs, () => {
    // Capture the tab alongside the query args so the insert gate stays bound
    // to the query it was registered on: after a tab switch the previous
    // tab's cached query keeps gating cache inserts by its own membership.
    const tab = viewContext().tab;
    return {
      enabled: requested() && Boolean(userId()),
      showSupportedForeignEntities: foreignEntities().enabled,
      meta: {
        insertFilter: homeTabInsertFilter(tab),
      },
    };
  });

  const searching = () => Boolean(state.search?.trim());
  const scopedNotifications = (entity: EntityData) =>
    getEntityNotifications(entity, notificationSource, {
      scopeChannelThreads: true,
    });
  const filterEntities = (entities: EntityData[]) => {
    const context = viewContext();
    return entities
      .filter((entity) => matchesCapabilities(entity, context.capabilities))
      .filter((entity) =>
        matchesTab(
          entity,
          context.tab,
          () => scopedNotifications(entity),
          searching()
        )
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
      if (!matchesTab(entity, context.tab, notifications, searching())) {
        return false;
      }
      return unreadFilterFn({ ...entity, notifications });
    });
  };

  const attachNotifications = (entity: EntityData) =>
    withEntityNotifications(entity, notificationSource, {
      scopeChannelThreads: true,
    });
  // Recent rows sort, bucket and show the time of the viewer's last touch,
  // or, for a search hit without one, of the item's last change.
  const transformEntities = (entities: EntityData[]) =>
    filterEntities(entities).map((entity) =>
      attachNotifications(
        viewContext().tab === 'recent'
          ? { ...entity, sortTs: entity.touchedAt ?? homeSortTimestamp(entity) }
          : entity
      )
    );

  return {
    query,
    viewContext,
    filterEntities,
    attachNotifications,
    transformEntities,
    hasUnreadEntity,
    notificationSource,
    awaitingViewer,
  };
}

export type HomeListDataSource = HomeDataSource & {
  /** Set when Home's rows complete as work feed items. */
  markDoneDelegate: Accessor<MarkDoneDelegate | undefined>;
};

/**
 * Home's list. Desktop Signal reads the server work feed, since the feed's
 * live changes ride the GraphQL Soup websocket and cache; every other view
 * (Noise, touch devices) merges Soup, notification and recent-activity
 * sources on the client. Searching a feed-backed Home lists the feed's rows
 * whose name matches, then the search service's hits.
 */
export function useHomeDataSource(
  state: HomeDataSourceInput
): HomeListDataSource {
  const listsWorkFeed = () => state.tab === 'signal' && !isTouchDevice();
  const usesWorkFeed = () => listsWorkFeed() && !state.search.trim();

  // The feed stays live while searching: its rows are what the search finds.
  const workFeed = useWorkFeedHomeDataSource(state, { enabled: listsWorkFeed });
  const soup = useSoupHomeDataSource(state, {
    enabled: () => !usesWorkFeed(),
    listed: () => (listsWorkFeed() ? workFeed.entities() : undefined),
    listedLoading: () => listsWorkFeed() && workFeed.isLoading(),
  });
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
    // Feed rows found by a search complete as feed items too; the delegate
    // passes on rows the feed does not hold.
    markDoneDelegate: () =>
      listsWorkFeed() ? workFeed.markDoneDelegate() : undefined,
  };
}

function useSoupHomeDataSource(
  state: HomeDataSourceInput,
  options: {
    enabled: () => boolean;
    /** The rows a server-listed Home shows, which search must find. */
    listed?: () => WithNotification<EntityData>[] | undefined;
    listedLoading?: () => boolean;
  }
): HomeDataSource {
  const {
    query,
    viewContext,
    filterEntities,
    attachNotifications,
    transformEntities,
    awaitingViewer,
  } = useHomeEntitiesQuery(state, options);
  const notificationsLoading = () => awaitingViewer() || query.isLoading;

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

  const entityPool = useSearchContext().entityPool(() =>
    Boolean(state.search.trim())
  );
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
    surface: () => 'home',
    text: () => state.search,
    localPool,
    buildRequest: (request) => buildHomeSearchRequest(viewContext(), request),
  });

  const rawEntities = createMemo<EntityData[]>((previous) => {
    if (!search.isSearching()) {
      const notifications = notificationsLoading()
        ? []
        : (query.data?.entities ?? []);
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
        oldestFetchedTimestamp: notificationsLoading()
          ? undefined
          : query.data?.oldestFetchedTimestamp,
        hasMore: query.hasNextPage && !query.error,
        isLoading: notificationsLoading(),
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

  const shownEntities = createMemo(() => {
    const listed = options.listed?.();
    const query = state.search.trim();
    if (!listed || !query) return entities().items;

    return searchListedHomeEntities(listed, entities().items, query);
  });

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
        mergeRecents() || state.tab === 'recent'
          ? groupHomeEntitiesByDate(shownEntities(), new Date(now()))
          : groupHomeEntitiesByTabDate(shownEntities(), viewContext()),
        // The viewer's own activity moves a Recent row to a newer section;
        // keyed by entity, it keeps its focus and selection as it moves.
        { keyByEntity: state.tab === 'recent' }
      );
    } else {
      result = buildFlatSoupRows(shownEntities());
    }

    return result;
  });
  const items = createSoupRowStore(builtItems);

  const isLoading = () => {
    if (hasNoTypes()) return false;
    if (!search.isSearching()) {
      return (
        (notificationsLoading() || (mergeRecents() && recentQuery.isLoading)) &&
        shownEntities().length === 0
      );
    }
    if (shownEntities().length > 0) return false;
    if (options.listedLoading?.()) return true;
    if (usesServiceSearch()) return search.isLoading();
    return notificationsLoading();
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
        return shownEntities().length === 0 && !hasMore()
          ? (query.error ??
              (mergeRecents() ? recentQuery.error : undefined) ??
              undefined)
          : undefined;
      // The feed's matching rows need no request, so they outlast a failed one.
      return shownEntities().length === 0 ? search.error() : undefined;
    },
    warning: () => {
      if (usesServiceSearch() || (shownEntities().length === 0 && !hasMore()))
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
