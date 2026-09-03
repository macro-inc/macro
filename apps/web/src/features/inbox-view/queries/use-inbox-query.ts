import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  createSoupLoadMoreRow,
  type SoupRow,
  testFacets,
  useSearchContext,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
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
import {
  type EntityData,
  isSnippetEntity,
  type WithNotification,
} from '@entity';
import type { NotificationSource } from '@notifications';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { startOfDay, subWeeks } from 'date-fns';
import { createMemo } from 'solid-js';
import { match } from 'ts-pattern';
import {
  explicitNoiseFilter,
  noiseFilter,
  signalFilter,
} from '../../next-soup/filters/inbox-filters';
import {
  notDoneFilter,
  scheduledRemindersFilter,
} from '../../next-soup/filters/predicates';
import { INBOX_FACETS, type InboxFacetContext } from '../inbox-facets';
import type { InboxTab, InboxViewState } from '../types';
import {
  buildInboxQuery,
  type InboxQueryCapabilities,
  type InboxViewContext,
} from './inbox-query';
import { groupInboxEntitiesByDate, inboxSortTimestamp } from './inbox-results';
import { buildInboxSearchRequest } from './inbox-search';

export type InboxDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type InboxDataSource = ListDataSource<InboxDataSourceItem>;

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
  entity: WithNotification<EntityData>,
  tab: InboxTab,
  source: NotificationSource
): boolean {
  return match(tab)
    .with('signal', () => {
      if (!signalFilter(entity) || !notDoneFilter(source)(entity)) return false;

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
    .with('noise', () => noiseFilter(entity) && notDoneFilter(source)(entity))
    .with('all', () => !explicitNoiseFilter(entity))
    .with('reminders', () => scheduledRemindersFilter(entity))
    .exhaustive();
}

export function useInboxDataSource(
  state: InboxDataSourceInput
): InboxDataSource {
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

  const query = useSoupAstItemsQuery(queryArgs, () => ({
    enabled: true,
    showSupportedForeignEntities: foreignEntities().enabled,
  }));

  const transformEntities = (entities: EntityData[]) => {
    const context = viewContext();
    return entities
      .filter((entity) => matchesCapabilities(entity, context.capabilities))
      .map((entity) =>
        withEntityNotifications(entity, notificationSource, {
          scopeChannelThreads: true,
        })
      )
      .filter((entity) => matchesTab(entity, context.tab, notificationSource));
  };

  const { entityPool } = useSearchContext();
  const localPool = createMemo(() => {
    if (!state.search.trim()) return [];
    const pool = entityPool();
    const matchingIds = new Set(
      transformEntities(pool.map((item) => item.data)).map(
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
      if (query.isLoading) return previous;

      return query.data?.entities ?? [];
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

  // Keep rows admitted after they transition from unread to read. Changing the
  // tab or read filter starts a new admission scope.
  const entities = createMemo<{
    readScope: string;
    admittedIds: Set<string>;
    items: WithNotification<EntityData>[];
  }>(
    (previous) => {
      const context = viewContext();
      const transformed = transformEntities(rawEntities());
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

  const hasMore = () => {
    if (usesServiceSearch()) return search.hasNextPage();
    return query.hasNextPage;
  };

  const isLoadingMore = () => {
    if (usesServiceSearch()) return search.isFetchingNextPage();
    return query.isFetchingNextPage;
  };

  const items = createMemo<InboxDataSourceItem[]>(() => {
    let result: InboxDataSourceItem[];
    if (state.groupBy === 'date' && !search.isSearching()) {
      result = buildGroupedSoupRows(
        groupInboxEntitiesByDate(entities().items, viewContext())
      );
    } else {
      result = buildFlatSoupRows(entities().items);
    }

    if (hasMore()) {
      result.push(
        createSoupLoadMoreRow({
          scopeId: `inbox:${state.tab}`,
          isLoading: isLoadingMore(),
        })
      );
    }

    return result;
  });

  const isLoading = () => {
    if (!search.isSearching()) {
      return query.isLoading && rawEntities().length === 0;
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
      return usesServiceSearch() ? search.isFetching() : query.isFetching;
    },
    error: () => {
      if (!usesServiceSearch()) return query.error ?? undefined;
      return search.error();
    },
    hasMore,
    isLoadingMore,
    loadMore: async () => {
      if (usesServiceSearch()) {
        await search.fetchNextPage();
        return;
      }
      await query.fetchNextPage();
    },
    refresh: async () => {
      if (usesServiceSearch()) {
        await search.refetch();
        return;
      }
      await query.refresh();
    },
  } satisfies InboxDataSource;
}
