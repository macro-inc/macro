import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  createSoupLoadMoreRow,
  isSoupRowVisible,
  type SoupRow,
  testFacets,
  useSearchContext,
} from '@app/features/soup';
import { withEntityNotifications } from '@app/features/soup/entity-notifications';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import {
  ENABLE_CALENDAR_UI,
  ENABLE_REMINDERS,
  ENABLE_SNIPPETS,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
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
import type { InboxViewState } from '../create-inbox-view-state';
import { INBOX_FACETS, type InboxFacetContext } from '../inbox-facets';
import type { InboxTab } from '../types';
import {
  buildInboxQuery,
  type InboxQueryCapabilities,
  type InboxViewContext,
} from './inbox-query';
import { groupInboxEntitiesByDate } from './inbox-results';
import { buildInboxSearchRequest } from './inbox-search';

export type InboxDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type InboxDataSource = ListDataSource<InboxDataSourceItem>;

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
        new Date(entity.sortTs ?? entity.updatedAt ?? 0).getTime() >=
        subWeeks(startOfDay(new Date()), 2).getTime()
      );
    })
    .with('noise', () => noiseFilter(entity) && notDoneFilter(source)(entity))
    .with('all', () => !explicitNoiseFilter(entity))
    .with('reminders', () => scheduledRemindersFilter(entity))
    .exhaustive();
}

export function useInboxDataSource(state: InboxViewState): InboxDataSource {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const foreignEntities = useFeatureFlag(
    ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG,
    { enabledOverride: ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE }
  );

  const facetContext = (): InboxFacetContext => ({ notificationSource });

  const capabilities = (): InboxQueryCapabilities => ({
    calendar: ENABLE_CALENDAR_UI(),
    foreignEntities: foreignEntities().enabled,
    reminders: ENABLE_REMINDERS(),
    snippets: ENABLE_SNIPPETS(),
  });

  const viewContext = createMemo(
    (): InboxViewContext => ({
      tab: state.tab(),
      facets: state.facets(),
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
    if (!state.search().trim()) return [];
    const pool = entityPool();
    const matchingIds = new Set(
      transformEntities(pool.map((item) => item.data)).map(
        (entity) => entity.id
      )
    );
    return pool.filter((item) => matchingIds.has(item.data.id));
  });

  const search = createSearchState({
    text: state.search,
    localPool,
    buildRequest: (request) => buildInboxSearchRequest(viewContext(), request),
  });

  const rawEntities = createMemo<EntityData[]>((previous) => {
    if (!search.isSearching()) {
      return query.isPlaceholderData ? [] : (query.data?.entities ?? []);
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
    if (state.groupBy() === 'date' && !search.isSearching()) {
      result = buildGroupedSoupRows(groupInboxEntitiesByDate(entities().items));
    } else {
      result = buildFlatSoupRows(entities().items);
    }

    if (hasMore()) {
      result.push(
        createSoupLoadMoreRow({
          scopeId: `inbox:${state.tab()}`,
          isLoading: isLoadingMore(),
        })
      );
    }

    return result.filter((row) =>
      isSoupRowVisible(row, state.groups.isExpanded)
    );
  });

  const isLoading = () => {
    if (!search.isSearching()) {
      return query.isLoading || query.isPlaceholderData;
    }
    if (entities().items.length > 0) return false;
    if (usesServiceSearch()) return search.isLoading();
    return query.isLoading || query.isPlaceholderData;
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
