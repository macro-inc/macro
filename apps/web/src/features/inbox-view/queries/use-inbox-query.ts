import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  type SoupRow,
  testFacets,
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
  enableInboxNotifiedSort,
  enableReminders,
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
import { notificationIsRead } from '@entity/utils/notification';
import type { UnifiedNotification } from '@notifications/types';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { startOfDay, subWeeks } from 'date-fns';
import { createMemo, createSignal, onCleanup, onMount } from 'solid-js';
import { match } from 'ts-pattern';
import {
  noiseFilter,
  signalFilter,
} from '../../next-soup/filters/inbox-filters';
import { scheduledRemindersFilter } from '../../next-soup/filters/predicates';
import { INBOX_FACETS, type InboxFacetContext } from '../inbox-facets';
import type { InboxTab, InboxViewState } from '../types';
import { homeClock, homeTimestamp } from './home-date-buckets';
import { getHomePagination } from './home-pagination';
import { soupItemMatchesInboxTab } from './inbox-item-filter';
import {
  buildInboxQuery,
  type InboxQueryCapabilities,
  type InboxViewContext,
} from './inbox-query';
import {
  groupHomeEntitiesByDate,
  groupInboxEntitiesByDate,
  inboxSortTimestamp,
  mergeHomeEntities,
} from './inbox-results';
import { buildInboxSearchRequest } from './inbox-search';

export type InboxDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type InboxDataSource = ListDataSource<InboxDataSourceItem> & {
  warning: () => string | undefined;
};

export type InboxDataSourceInput = Pick<
  InboxViewState,
  'tab' | 'search' | 'groupBy' | 'facets'
>;

function matchesCapabilities(
  entity: EntityData,
  capabilities: InboxQueryCapabilities
): boolean {
  if (entity.type === 'calendar_event') return capabilities.calendar;
  if (entity.type === 'foreign') return capabilities.foreignEntities;
  if (entity.type === 'reminder') return capabilities.reminders;
  if (isSnippetEntity(entity)) return capabilities.snippets;

  return true;
}

function matchesTab(
  entity: EntityData,
  tab: InboxTab,
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
        new Date(inboxSortTimestamp(entity) ?? 0).getTime() >=
        subWeeks(startOfDay(new Date()), 2).getTime()
      );
    })
    .with('noise', () => noiseFilter(entity) && notDone())
    .with('reminders', () => scheduledRemindersFilter(entity))
    .exhaustive();
}

/** Shared feed membership for the Inbox list and its sidebar unread indicator. */
export function useInboxEntitiesQuery(
  state: Pick<InboxDataSourceInput, 'tab' | 'facets'>
) {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const foreignEntities = useFeatureFlag(enableSupportedSoupForeignEntities);
  const notifiedSort = useFeatureFlag(enableInboxNotifiedSort);

  const facetContext = (): InboxFacetContext => ({ notificationSource });

  const capabilities = (): InboxQueryCapabilities => ({
    calendar: isFeatureEnabled(enableCalendarUi),
    foreignEntities: foreignEntities().enabled,
    notifiedSort: notifiedSort().enabled,
    reminders: isFeatureEnabled(enableReminders),
    snippets: isFeatureEnabled(enableSnippets),
  });

  const viewContext = createMemo(
    (): InboxViewContext => ({
      tab: state.tab,
      facets: state.facets,
      facetContext: facetContext(),
      capabilities: capabilities(),
      userId: userId(),
    })
  );

  const queryArgs = createMemo(() => buildInboxQuery(viewContext()));

  const query = useSoupAstItemsQuery(queryArgs, () => {
    // Capture the tab alongside the query args so the insert gate stays bound
    // to the query it was registered on: after a tab switch the previous
    // tab's cached query keeps gating cache inserts by its own membership.
    const tab = viewContext().tab;
    return {
      enabled: true,
      showSupportedForeignEntities: foreignEntities().enabled,
      meta: {
        insertFilter: (item) => soupItemMatchesInboxTab(item, tab),
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
      return entity.type === 'email'
        ? !entity.isRead
        : notifications().some(
            (notification) => !notificationIsRead(notification)
          );
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

export function useInboxDataSource(
  state: InboxDataSourceInput
): InboxDataSource {
  const {
    query,
    viewContext,
    filterEntities,
    attachNotifications,
    transformEntities,
  } = useInboxEntitiesQuery(state);

  const [now, setNow] = createSignal(homeClock());
  onMount(() => {
    const timer = setInterval(() => setNow(homeClock()), 30_000);
    onCleanup(() => clearInterval(timer));
  });

  // Only desktop Home merges the viewer's own recents into Signal; touch
  // devices keep Signal a pure notification feed, like the legacy
  // Notifications view.
  const mergeRecents = () => state.tab === 'signal' && !isTouchDevice();

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
        ).map(attachNotifications)
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
    buildRequest: (request) => buildInboxSearchRequest(viewContext(), request),
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

  // Keep rows admitted after they transition from unread to read. Changing the
  // tab or read filter starts a new admission scope.
  const entities = createMemo<{
    readScope: string;
    admittedIds: Set<string>;
    items: WithNotification<EntityData>[];
  }>(
    (previous) => {
      const context = viewContext();
      const transformed = transformHomeEntities(
        rawEntities(),
        search.isSearching() ? rawEntities() : recentEntities()
      ).filter((entity) => {
        const cutoff = homePagination()?.cutoff ?? -Infinity;
        return (
          cutoff === -Infinity ||
          (homeTimestamp(entity.sortTs) ?? -Infinity) > cutoff
        );
      });
      const activeReadFacets = context.facets.read ?? [];
      const readScope = `${context.tab}:${activeReadFacets.join(',')}`;
      const admittedIds =
        previous.readScope === readScope
          ? new Set(previous.admittedIds)
          : new Set<string>();

      if (activeReadFacets.length === 0) {
        for (const entity of transformed) admittedIds.add(entity.id);
      } else {
        const readSelection = { read: activeReadFacets };
        for (const entity of transformed) {
          if (
            testFacets(
              readSelection,
              INBOX_FACETS,
              entity,
              context.facetContext
            )
          ) {
            admittedIds.add(entity.id);
          }
        }
      }

      const selection = { ...context.facets, read: [] };
      return {
        readScope,
        admittedIds,
        items: transformed.filter(
          (entity) =>
            admittedIds.has(entity.id) &&
            testFacets(selection, INBOX_FACETS, entity, context.facetContext)
        ),
      };
    },
    { readScope: '', admittedIds: new Set<string>(), items: [] }
  );

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

  const items = createMemo<InboxDataSourceItem[]>(() => {
    let result: InboxDataSourceItem[];
    if (state.groupBy === 'date' && !search.isSearching()) {
      result = buildGroupedSoupRows(
        mergeRecents()
          ? groupHomeEntitiesByDate(entities().items, new Date(now()))
          : groupInboxEntitiesByDate(entities().items, viewContext())
      );
    } else {
      result = buildFlatSoupRows(entities().items);
    }

    return result;
  });

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
  } satisfies InboxDataSource;
}
