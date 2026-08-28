import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSoupLoadMoreRow,
  dateBucket,
  groupSoupEntities,
  isSoupRowVisible,
  type SoupRow,
  testFacets,
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
import { debouncedDependent } from '@core/util/debounce';
import {
  type EntityData,
  isSnippetEntity,
  type WithNotification,
} from '@entity';
import type { NotificationSource } from '@notifications';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { useSearchSoupQuery } from '@queries/soup/search';
import { startOfDay, subWeeks } from 'date-fns';
import { createMemo } from 'solid-js';
import { match, P } from 'ts-pattern';
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
import { buildInboxQuery, type InboxQueryCapabilities } from './inbox-query';
import { buildInboxSearchRequest } from './inbox-search';

function groupLabel(entity: EntityData): string {
  return match(entity.type)
    .with('document', () => 'Documents')
    .with('email', () => 'Email')
    .with(
      P.union('channel', 'channel_message', 'channel_thread'),
      () => 'Channels'
    )
    .with('chat', () => 'Agents')
    .with('project', () => 'Projects')
    .with('foreign', () => 'GitHub')
    .with('reminder', () => 'Reminders')
    .with('calendar_event', () => 'Calendar')
    .with('call', () => 'Calls')
    .with(P.union('crm_company', 'crm_contact'), () => 'CRM')
    .with('automation', () => 'Automations')
    .exhaustive();
}

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

export function useInboxQuery(state: InboxViewState) {
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

  const queryArgs = createMemo(() =>
    buildInboxQuery({
      tab: state.tab(),
      facets: state.facets(),
      facetContext: facetContext(),
      userId: userId(),
      capabilities: capabilities(),
    })
  );

  const searchText = () => state.search().trim();
  const serviceSearchText = debouncedDependent(searchText, 300);
  const usesServiceSearch = () => serviceSearchText().length >= 3;

  const query = useSoupAstItemsQuery(queryArgs, () => ({
    enabled: !usesServiceSearch(),
    showSupportedForeignEntities: foreignEntities().enabled,
  }));

  const searchQuery = useSearchSoupQuery(
    () =>
      buildInboxSearchRequest({
        query: serviceSearchText(),
        tab: state.tab(),
        facets: state.facets(),
        userId: userId(),
        capabilities: capabilities(),
      }),
    () => ({ enabled: usesServiceSearch() })
  );

  const usesPlaceholderData = () =>
    !usesServiceSearch() && query.isPlaceholderData;

  const sourceEntities = () => {
    if (usesPlaceholderData()) return [];
    if (usesServiceSearch()) return searchQuery.data ?? [];

    return query.data?.entities ?? [];
  };

  const attachedEntities = createMemo(() =>
    sourceEntities()
      .filter((entity) => matchesCapabilities(entity, capabilities()))
      .map((entity) =>
        withEntityNotifications(entity, notificationSource, {
          scopeChannelThreads: true,
        })
      )
  );

  const tabEntities = createMemo(() =>
    attachedEntities().filter((entity) =>
      matchesTab(entity, state.tab(), notificationSource)
    )
  );

  const readFacet = () => state.facets().read ?? [];
  const admittedByReadFilter = createMemo<{
    scope: string;
    ids: ReadonlySet<string>;
  }>(
    (previous) => {
      const active = readFacet();
      const scope = `${state.tab()}:${active.join(',')}`;
      const ids =
        previous?.scope === scope ? new Set(previous.ids) : new Set<string>();

      if (active.length === 0) {
        for (const entity of tabEntities()) ids.add(entity.id);
        return { scope, ids };
      }

      const selection = { read: active };
      for (const entity of tabEntities()) {
        if (testFacets(selection, INBOX_FACETS, entity, facetContext())) {
          ids.add(entity.id);
        }
      }

      return { scope, ids };
    },
    { scope: '', ids: new Set<string>() }
  );

  const refinedEntities = createMemo(() => {
    const selection = { ...state.facets(), read: [] };
    return tabEntities().filter(
      (entity) =>
        admittedByReadFilter().ids.has(entity.id) &&
        testFacets(selection, INBOX_FACETS, entity, facetContext())
    );
  });

  const searchedEntities = createMemo(() => {
    if (usesServiceSearch()) return refinedEntities();

    const search = state.search().trim().toLocaleLowerCase();
    if (!search) return refinedEntities();

    return refinedEntities().filter((entity) =>
      entity.name.toLocaleLowerCase().includes(search)
    );
  });

  const hasNextPage = () => {
    if (usesServiceSearch()) return searchQuery.hasNextPage ?? false;
    return query.hasNextPage;
  };
  const loadingMore = () => {
    if (usesServiceSearch()) return searchQuery.isFetchingNextPage;
    return query.isFetchingNextPage;
  };

  const rows = createMemo<SoupRow<WithNotification<EntityData>>[]>(() => {
    const entities = searchedEntities();
    let result: SoupRow<WithNotification<EntityData>>[];

    if (state.groupBy() === 'none') {
      result = buildFlatSoupRows(entities);
    } else if (state.groupBy() === 'date') {
      const groups = groupSoupEntities(entities, {
        getGroupId: (entity) =>
          dateBucket(entity.sortTs ?? entity.updatedAt ?? entity.createdAt).key,
        getGroupLabel: (_groupId, entity) =>
          dateBucket(entity.sortTs ?? entity.updatedAt ?? entity.createdAt)
            .label,
      });
      result = buildGroupedSoupRows(groups);
    } else {
      const groups = groupSoupEntities(entities, {
        getGroupId: groupLabel,
        getGroupLabel: (_groupId, entity) => groupLabel(entity),
      });
      result = buildGroupedSoupRows(groups);
    }

    if (hasNextPage()) {
      result.push(
        createSoupLoadMoreRow({
          scopeId: `inbox:${state.tab()}`,
          isLoading: loadingMore(),
        })
      );
    }

    return result.filter((row) =>
      isSoupRowVisible(row, state.groups.isExpanded)
    );
  });

  return {
    rows,
    entities: searchedEntities,
    loading: () =>
      usesServiceSearch()
        ? searchQuery.isLoading
        : query.isLoading || query.isPlaceholderData,
    fetching: () =>
      usesServiceSearch() ? searchQuery.isFetching : query.isFetching,
    refreshing: () =>
      usesServiceSearch()
        ? searchQuery.isFetching && !searchQuery.isFetchingNextPage
        : query.isFetching && !query.isFetchingNextPage,
    placeholder: usesPlaceholderData,
    error: () => {
      if (!usesServiceSearch()) return query.error;
      return searchQuery.error instanceof Error ? searchQuery.error : null;
    },
    hasNextPage,
    loadingMore,
    loadMore: async () => {
      if (usesServiceSearch()) {
        await searchQuery.fetchNextPage();
        return;
      }
      await query.fetchNextPage();
    },
    refresh: async () => {
      if (usesServiceSearch()) {
        await searchQuery.refetch();
        return;
      }
      await query.refresh();
    },
  };
}

export type InboxQuery = ReturnType<typeof useInboxQuery>;
