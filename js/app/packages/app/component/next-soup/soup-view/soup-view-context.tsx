import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  createSoupState,
  type GroupMeta,
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
import { ENABLE_FEATURED_SEARCH_RESULTS } from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import { throwOnErr } from '@core/util/maybeResult';
import {
  type EntityData,
  getPropertyOptionLabel,
  isWithNotification,
} from '@entity';
import { useNotificationsForEntity } from '@notifications';
import { useQueryClient } from '@queries/client';
import {
  parseGroupedSoupPage,
  serializeGroupByField,
} from '@queries/soup/grouped/api';
import type {
  GroupMeta as ApiGroupMeta,
  GroupByField,
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

  const rows = createMemo((): SoupRow[] => {
    const field = groupByField();
    const groups = itemsQuery.data?.groups;

    // Not grouped - build simple entity rows
    if (!field || !groups) {
      return entities().map((entity, index) =>
        soup.buildRow({ id: entity.id, index, original: entity })
      );
    }

    // Grouped - build header + entity + loadMore rows for each group
    const result: SoupRow[] = [];
    let globalIndex = 0;

    for (const apiGroup of groups) {
      const groupMeta = buildGroupMeta(apiGroup);
      const isExpanded = soup.grouping.isExpanded(apiGroup.key);
      const query = groupQueries().find((q) => q.key === apiGroup.key);
      const groupEntities = query?.data() ?? [];

      // Get first entity to use for header original
      // If the group has no entities, we can skip it
      const firstEntity = groupEntities[0];

      if (!firstEntity) continue;

      // Header row
      result.push(
        soup.buildRow({
          id: `header:${apiGroup.key}`,
          index: globalIndex++,
          original: firstEntity,
          group: groupMeta,
          isGrouped: true,
        })
      );

      // We skip building rows for entities that are
      // not visible because the group is collapsed
      if (!isExpanded) continue;

      // Entity rows
      for (const entity of groupEntities) {
        result.push(
          soup.buildRow({
            id: entity.id,
            index: globalIndex++,
            original: entity,
            group: groupMeta,
          })
        );
      }

      // We can stop here if the group has no more data
      // that needs to be fetched
      if (!groupMeta.hasMore()) continue;

      const lastEntity = groupEntities[groupEntities.length - 1];

      result.push(
        soup.buildRow({
          id: `loadmore:${apiGroup.key}`,
          index: globalIndex++,
          original: lastEntity,
          group: groupMeta,
          isLoadMore: true,
        })
      );
    }

    return result;
  });

  const instructionsIdQuery = useInstructionsMdIdQuery();

  const groupQueries = createInfiniteQueries<GroupedSoupPage, SoupEntity[]>(
    () => {
      const field = groupByField();
      const groups = itemsQuery.data?.groups;
      const items = itemsQuery.data?.items;
      const dataVersion = itemsQuery.dataUpdatedAt;

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
          queryKey: [
            ...soupKeys.groupedGroup({
              params: soupParams(),
              body: soupBody(),
              groupBy: field,
              groupKey: group.key,
            }).queryKey,
            dataVersion,
          ] as readonly unknown[],
          queryFn: async (ctx: { pageParam: string | null }) => {
            const response = await throwOnErr(async () =>
              storageServiceClient.getGroupedSoupAstItems({
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

  const loadMoreForGroup = async (groupKey: string): Promise<void> => {
    const query = groupQueries().find((q) => q.key === groupKey);
    await query?.fetchNextPage();
  };

  const isGroupLoadingMore = (groupKey: string) => {
    const query = groupQueries().find((q) => q.key === groupKey);
    return query?.isFetchingNextPage() ?? false;
  };

  const hasMoreForGroup = (groupKey: string) => {
    const query = groupQueries().find((q) => q.key === groupKey);
    return query?.hasNextPage() ?? false;
  };

  const buildGroupMeta = (group: ApiGroupMeta): GroupMeta => {
    const resolvedLabel = getPropertyOptionLabel(group.key) ?? group.label;
    return {
      key: group.key,
      value: group.key,
      label: resolvedLabel,
      count: group.totalCount,
      isExpanded: () => soup.grouping.isExpanded(group.key),
      toggle: () => soup.grouping.toggle(group.key),
      hasMore: () => hasMoreForGroup(group.key),
      loadMore: () => loadMoreForGroup(group.key),
      isLoading: () => isGroupLoadingMore(group.key),
    };
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
