import type { ListDataSource } from '@app/components/list';
import {
  buildFlatSoupRows,
  buildGroupedSoupRows,
  createSearchState,
  type SoupRow,
  testFacets,
  useSearchContext,
} from '@app/features/soup';
import { useGlobalNotificationSource } from '@components/app/GlobalAppState';
import { useUserId } from '@core/context/user';
import type { EntityData, WithNotification } from '@entity';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { createMemo } from 'solid-js';
import { INBOX_FACETS, type InboxFacetContext } from '../inbox-facets';
import type { InboxViewState } from '../types';
import {
  selectInboxEntities,
  useInboxQueryCapabilities,
} from './inbox-eligibility';
import { soupItemMatchesInboxTab } from './inbox-item-filter';
import { buildInboxQuery, type InboxViewContext } from './inbox-query';
import { groupInboxEntitiesByDate } from './inbox-results';
import { buildInboxSearchRequest } from './inbox-search';

export type InboxDataSourceItem = SoupRow<WithNotification<EntityData>>;

export type InboxDataSource = ListDataSource<InboxDataSourceItem>;

export type InboxDataSourceInput = Pick<
  InboxViewState,
  'tab' | 'search' | 'groupBy' | 'facets'
>;

export function useInboxDataSource(
  state: InboxDataSourceInput
): InboxDataSource {
  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  const capabilities = useInboxQueryCapabilities();

  const facetContext = (): InboxFacetContext => ({ notificationSource });

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
      showSupportedForeignEntities: capabilities().foreignEntities,
      meta: {
        insertFilter: (item) => soupItemMatchesInboxTab(item, tab),
      },
    };
  });

  const transformEntities = (entities: EntityData[]) =>
    selectInboxEntities(entities, viewContext(), notificationSource);

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
