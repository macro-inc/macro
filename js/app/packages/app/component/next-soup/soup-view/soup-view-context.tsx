import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  createSoupState,
  type GroupMeta as UiGroupMeta,
  type SoupEntity,
  type SoupRow,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import type { FilterContext } from '@app/component/next-soup/filters/configs/';
import {
  createQueryStore,
  type Query,
  type QueryStore,
} from '@app/component/next-soup/filters/filter-store/query-store';
import { createInfiniteQueries } from '@app/component/next-soup/soup-view/create-infinite-queries';
import { createSearchState } from '@app/component/next-soup/soup-view/create-search-state';
import { deduplicateEntities } from '@app/component/next-soup/utils';
import { throwOnErr } from '@core/util/maybeResult';
import { ENABLE_FEATURED_SEARCH_RESULTS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  type EntityData,
  isWithNotification,
  getPropertyOptionLabel,
} from '@entity';
import { useNotificationsForEntity } from '@notifications';
import { useQueryClient } from '@queries/client';
import {
  serializeGroupByField,
  parseGroupedSoupPage,
} from '@queries/soup/grouped/api';
import type {
  GroupByField,
  GroupMeta,
  GroupedSoupPage,
} from '@queries/soup/grouped/types';
import { type SoupParams, useSoupAstItemsQuery } from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
import { mapSoupPageToEntityList } from '@queries/soup/transform-utils';
import { useInstructionsMdIdQuery } from '@queries/storage/instructions-md';
import { storageServiceClient } from '@service-storage/client';
import type { SoupPage } from '@service-storage/generated/schemas';
import type { InfiniteData } from '@tanstack/solid-query';
import {
  type Accessor,
  createContext,
  createEffect,
  createMemo,
  createRenderEffect,
  createSignal,
  type FlowComponent,
  on,
  type Setter,
  Suspense,
  useContext,
} from 'solid-js';

type DataSource<T> = {
  data: Accessor<T[]>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  hasNextPage: Accessor<boolean>;
  fetchNextPage: VoidFunction;
};

interface SoupViewContextValues {
  soup: SoupState;
  source: DataSource<EntityData>;
  searchText: Accessor<string>;
  setSearchText: (value: string) => void;
  searchPaused: Accessor<boolean>;
  setSearchPaused: Setter<boolean>;
  featuredIds: Accessor<string[]>;
  rows: Accessor<SoupRow[]>;
  isSearchServiceLoading: Accessor<boolean>;
  isLocalSearchSettling: Accessor<boolean>;
  queryFilters: QueryStore;
  assigneeFilter: Accessor<string[]>;
  setAssigneeFilter: Setter<string[]>;
  activeTab: Accessor<string | undefined>;
  setActiveTab: Setter<string | undefined>;
  groupByField: Accessor<GroupByField | undefined>;
  totalCount: Accessor<number>;
  getGroupAtIndex: (
    index: number
  ) =>
    | { group: GroupMeta; indexInGroup: number; isCollapsed: boolean }
    | undefined;
  getEntityAtGroupIndex: (
    groupKey: string,
    index: number
  ) => SoupEntity | undefined;
  getRowAtIndex: (index: number) => SoupRow | undefined;
  getGroupHeaderMeta: (groupKey: string) =>
    | {
        id: string;
        value: string;
        label: string;
        count: number;
        isExpanded: () => boolean;
        toggle: () => void;
      }
    | undefined;
  loadMoreForGroup: (groupKey: string) => void;
  isGroupLoadingMore: (groupKey: string) => boolean;
  getGroupLoadedCount: (groupKey: string) => number;
  hasMoreForGroup: (groupKey: string) => boolean;
}

export const SoupViewContext = createContext<SoupViewContextValues>();

export const useSoupView = () => {
  const context = useContext(SoupViewContext);

  if (!context) {
    throw new Error(
      'useSoupView can only be used under a SoupViewContext.Provider'
    );
  }

  return context;
};

export const useMaybeSoupView = () => useContext(SoupViewContext);

interface SoupViewContextProviderProps {
  soup?: SoupState;
  initialQuery?: Query;
  initialSearchText?: string;
  disableLocalSearch?: boolean;
  /**
   * Additional client-side entities to merge into the soup item stream.
   * Visibility is still controlled by the active client filters.
   */
  additionalEntities?: Accessor<EntityData[]>;
}

type ApiSortMethod = NonNullable<SoupParams['sort_method']>;
const VALID_API_SORT_METHODS: ApiSortMethod[] = [
  'viewed_at',
  'created_at',
  'updated_at',
  'viewed_updated',
];

export const SoupViewContextProvider: FlowComponent<
  SoupViewContextProviderProps
> = (props) => {
  const soup = props.soup ?? createSoupState();

  const queryClient = useQueryClient();

  const soupParams = createMemo((): SoupParams => {
    const sortId = soup.sort.active()[0]?.id ?? 'updated_at';

    // Client-only sorts (priority, status) fall back to created_at for the API
    const sortMethod = VALID_API_SORT_METHODS.includes(sortId as ApiSortMethod)
      ? (sortId as ApiSortMethod)
      : 'created_at';

    return {
      limit: 100,
      sort_method: sortMethod,
    };
  });

  const store = createQueryStore({ initial: props.initialQuery });

  const invalidateCache = () => {
    queryClient.setQueryData(
      soupKeys.astItems({
        params: soupParams(),
        body: soupBody(),
      }).queryKey,
      (prev: InfiniteData<SoupPage> | SoupPage | undefined) => {
        if (!prev) return;
        if ('pages' in prev) {
          prev.pages.splice(1, prev.pages.length);
          return prev;
        }
        return prev;
      }
    );
  };

  const queryFilters: QueryStore = {
    ...store,
    set: (query) => {
      invalidateCache();
      store.set(query);
    },
    replace: (query) => {
      invalidateCache();
      store.replace(query);
    },
    add: (query) => {
      invalidateCache();
      store.add(query);
    },
    remove: (query) => {
      invalidateCache();
      store.remove(query);
    },
  };

  const [searchPaused, setSearchPaused] = createSignal(false);
  const [assigneeFilter, setAssigneeFilter] = createSignal<string[]>([]);
  const [activeTab, setActiveTab] = createSignal<string | undefined>(undefined);

  const groupByField = createMemo((): GroupByField | undefined => {
    const id = soup.grouping.activeGroupId();
    if (!id) return undefined;
    if (id === 'date') return { type: 'date' };
    if (id === 'entity_type') return { type: 'entity_type' };
    if (id === 'project') return { type: 'project' };
    if (id.startsWith('property:')) {
      return {
        type: 'property',
        propertyDefinitionId: id.slice('property:'.length),
      };
    }
    return undefined;
  });

  // Clear sub-filters when task filter is deactivated
  createEffect(() => {
    if (!soup.predicates.isActive('task')) {
      setAssigneeFilter([]);
    }
  });

  // soupBody is derived from the query filter store's compiled AST
  const soupBody = createMemo(() => queryFilters.compile());

  const search = createSearchState({
    soup,
    filters: () => queryFilters.state,
    assignees: assigneeFilter,
    disableLocalSearch: props.disableLocalSearch,
    searchPaused,
    initialText: props.initialSearchText,
  });

  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();

  // Create filter context for context-aware filter predicates
  const getFilterContext = (): FilterContext => ({
    userId: userId(),
    notificationSource,
    assignees: assigneeFilter(),
  });

  const attachNotifications = (entity: EntityData) => {
    return {
      ...entity,
      notifications: useNotificationsForEntity(notificationSource, entity),
    };
  };

  const itemsQuery = useSoupAstItemsQuery(
    () => ({
      params: soupParams(),
      body: soupBody(),
      groupBy: groupByField(),
    }),
    () => ({
      enabled: !search.isSearching(),
    })
  );

  const items = createMemo<SoupEntity[]>(
    (prev) => {
      const searching = search.isSearching();

      if (!searching) {
        const data = itemsQuery.data;

        if (!data) return prev;

        const base = data.entities.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];

        const extras = props.additionalEntities?.() ?? [];

        if (extras.length === 0) return base;

        const extraEntities = extras.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];

        return [...extraEntities, ...base];
      }

      const local = search.localFuzzyResults();
      const service = search.serviceSearchResults();

      const merged: SoupEntity[] = [...service, ...local];

      if (
        merged.length === 0 &&
        prev.length > 0 &&
        search.isLocalSearchSettling()
      ) {
        return prev;
      }

      for (let i = 0; i < merged.length; i++) {
        const entity = merged[i];
        if (entity.notifications) continue;
        merged[i] = attachNotifications(entity);
      }

      return merged;
    },
    [],
    {
      equals: false,
    }
  );

  const baseEntities = () => {
    let transformed = items();
    const ctx = getFilterContext();

    const next = [];
    for (const entity of transformed) {
      if (!soup.predicates.test(entity, ctx)) {
        continue;
      }
      next.push(entity);
    }

    transformed = deduplicateEntities(next);

    const sorts = soup.sort.active();
    if (sorts.length > 0 && !search.isSearching()) {
      transformed.sort((a, b) => {
        for (const sort of sorts) {
          const result = sort.fn(a, b);
          if (result !== 0) return result;
        }
        return 0;
      });
    }

    return transformed;
  };

  const entities = () => {
    const base = baseEntities();
    if (!ENABLE_FEATURED_SEARCH_RESULTS || !search.isSearching()) return base;

    const featuredIds = search.featuredIds();
    if (featuredIds.length === 0) return base;

    const entityMap = new Map(base.map((e) => [e.id, e]));
    const featuredIdSet = new Set(featuredIds);
    const featured: SoupEntity[] = [];

    for (const id of featuredIds) {
      const e = entityMap.get(id);
      if (e) featured.push(e);
    }

    const rest = base.filter((e) => !featuredIdSet.has(e.id));

    return [...featured, ...rest];
  };

  const rows = createMemo(() => {
    return entities().map((e) => soup.buildRow(e));
  });

  const getLoadedCountForGroup = (groupKey: string) => {
    const query = groupQueries().find((q) => q.key === groupKey);
    return query?.data()?.length ?? 0;
  };

  const totalCount = createMemo(() => {
    const groups = itemsQuery.data?.groups;
    if (!groups) return itemsQuery.data?.entities.length ?? 0;
    // Read groupQueries and collapsed state to create dependencies
    groupQueries();
    soup.grouping.collapsedGroups();
    return groups.reduce((sum, g) => {
      const isExpanded = soup.grouping.isExpanded(g.key);
      if (!isExpanded) {
        // Collapsed: just 1 slot for header
        return sum + 1;
      }
      const loadedCount = getLoadedCountForGroup(g.key) || g.pageCount;
      return sum + loadedCount;
    }, 0);
  });

  const getGroupAtIndex = (index: number) => {
    const groups = itemsQuery.data?.groups;
    if (!groups) return undefined;

    let cumulative = 0;
    for (const g of groups) {
      const isExpanded = soup.grouping.isExpanded(g.key);
      const groupSize = isExpanded
        ? getLoadedCountForGroup(g.key) || g.pageCount
        : 1; // collapsed = 1 slot for header

      if (index < cumulative + groupSize) {
        return {
          group: g,
          indexInGroup: index - cumulative,
          isCollapsed: !isExpanded,
        };
      }
      cumulative += groupSize;
    }
    return undefined;
  };

  const instructionsIdQuery = useInstructionsMdIdQuery();

  const groupQueries = createInfiniteQueries<GroupedSoupPage, SoupEntity[]>(
    () => {
      const field = groupByField();
      const groups = itemsQuery.data?.groups;
      const items = itemsQuery.data?.items;

      if (!field || !groups || !items) {
        return [];
      }

      return groups.map((group) => {
        const initialGroupItems = items.slice(
          group.startIndex,
          group.startIndex + group.pageCount
        );

        return {
          key: group.key,
          queryKey: soupKeys.groupedGroup({
            params: soupParams(),
            body: soupBody(),
            groupBy: field,
            groupKey: group.key,
          }).queryKey as readonly unknown[],
          queryFn: async (ctx: { pageParam: string | null }) => {
            const response = await throwOnErr(async () =>
              storageServiceClient.getSoupAstItems({
                params: {
                  cursor: ctx.pageParam ?? undefined,
                  group_by: serializeGroupByField(field),
                  group_key: group.key,
                },
                body: {
                  ...soupBody(),
                  ...soupParams(),
                },
              })
            );
            return parseGroupedSoupPage(response);
          },
          getNextPageParam: (lastPage: GroupedSoupPage): string | null => {
            const meta = lastPage.groups.find((g) => g.key === group.key);
            return meta?.nextCursor ?? null;
          },
          initialData: {
            pages: [
              {
                items: initialGroupItems,
                nextCursor: group.nextCursor,
                groups: [group],
              },
            ],
            pageParams: [null],
          },
          select: (pages: GroupedSoupPage[]): SoupEntity[] => {
            const allItems = pages.flatMap((p) => p.items);
            return mapSoupPageToEntityList(
              { items: allItems, next_cursor: null },
              { instructionsIdQuery }
            ).map((e) => attachNotifications(e)) as SoupEntity[];
          },
          enabled: true,
          staleTime: Infinity,
        };
      });
    }
  );

  const getEntityAtGroupIndex = (
    groupKey: string,
    index: number
  ): SoupEntity | undefined => {
    const query = groupQueries().find((q) => q.key === groupKey);
    return query?.data()?.[index];
  };

  const loadMoreForGroup = (groupKey: string) => {
    const query = groupQueries().find((q) => q.key === groupKey);
    query?.fetchNextPage();
  };

  const isGroupLoadingMore = (groupKey: string) => {
    const query = groupQueries().find((q) => q.key === groupKey);
    return query?.isFetchingNextPage() ?? false;
  };

  const getGroupLoadedCount = (groupKey: string) => {
    return getLoadedCountForGroup(groupKey);
  };

  const hasMoreForGroup = (groupKey: string) => {
    const query = groupQueries().find((q) => q.key === groupKey);
    return query?.hasNextPage() ?? false;
  };

  const getGroupHeaderMeta = (groupKey: string) => {
    const groups = itemsQuery.data?.groups;
    const group = groups?.find((g) => g.key === groupKey);
    if (!group) return undefined;

    const resolvedLabel = getPropertyOptionLabel(group.key) ?? group.label;
    return {
      id: group.key,
      value: group.key,
      label: resolvedLabel,
      count: group.totalCount,
      isExpanded: () => soup.grouping.isExpanded(group.key),
      toggle: () => soup.grouping.toggle(group.key),
    };
  };

  const getRowAtIndex = (index: number): SoupRow | undefined => {
    const field = groupByField();

    // Not grouped - use regular rows array
    if (!field) {
      return rows()[index];
    }

    // Grouped - look up via group queries
    const groupInfo = getGroupAtIndex(index);
    if (!groupInfo) return undefined;

    const { group, indexInGroup } = groupInfo;
    const entity = getEntityAtGroupIndex(group.key, indexInGroup);
    if (!entity) return undefined;

    const loadedCount = getLoadedCountForGroup(group.key);
    const isFirstInGroup = indexInGroup === 0;
    const isLastInGroup = indexInGroup === loadedCount - 1;

    // Build UI group meta for all entities in the group
    const uiGroup: UiGroupMeta = {
      id: group.key,
      value: group.key,
      label: getPropertyOptionLabel(group.key) ?? group.label,
      count: group.totalCount,
      isExpanded: () => soup.grouping.isExpanded(group.key),
      toggle: () => soup.grouping.toggle(group.key),
      hasMore: () => hasMoreForGroup(group.key),
      loadMore: () => loadMoreForGroup(group.key),
    };

    return soup.buildRow(entity, {
      group: uiGroup,
      indexInGroup,
      isFirstInGroup,
      isLastInGroup,
    });
  };

  const { searchQuery } = search;

  const context = {
    soup,
    source: {
      data: entities,
      isLoading: () => itemsQuery.isLoading,
      isFetching: () => itemsQuery.isFetching || searchQuery.isFetching,
      isFetchingNextPage: () =>
        itemsQuery.isFetchingNextPage || searchQuery.isFetchingNextPage,
      hasNextPage: () => {
        return (
          (itemsQuery.isEnabled && itemsQuery.hasNextPage) ||
          (searchQuery.isEnabled && searchQuery.hasNextPage)
        );
      },
      fetchNextPage: () => {
        if (itemsQuery.isEnabled) {
          itemsQuery.fetchNextPage();
        }
        if (searchQuery.isEnabled) {
          searchQuery.fetchNextPage();
        }
      },
    },
    rows,
    searchText: search.searchText,
    setSearchText: search.setSearchText,
    searchPaused,
    setSearchPaused,
    featuredIds: search.featuredIds,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
    queryFilters,
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
    setActiveTab,
    groupByField,
    totalCount,
    getGroupAtIndex,
    getEntityAtGroupIndex,
    getRowAtIndex,
    getGroupHeaderMeta,
    loadMoreForGroup,
    isGroupLoadingMore,
    getGroupLoadedCount,
    hasMoreForGroup,
  };

  return (
    <SoupViewContext.Provider value={context}>
      {props.children}
      <Suspense>
        <SyncWithSoup soup={soup} rows={rows()} />
      </Suspense>
    </SoupViewContext.Provider>
  );
};

interface SyncWithSoupProps {
  soup: SoupState;
  rows: SoupRow[];
}

const SyncWithSoup = (props: SyncWithSoupProps) => {
  createRenderEffect(on(() => props.rows, props.soup.setRows));

  return null;
};
