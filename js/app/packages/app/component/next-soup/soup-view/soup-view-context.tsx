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
  compileToAst,
  NIL_UUID,
  type QueryState,
} from '@app/component/next-soup/filters/filter-store';
import type { SetPredicatesInput } from '@app/component/next-soup/filters/filter-store/predicates-store';
import {
  createQueryStore,
  type Query,
  type QueryStore,
} from '@app/component/next-soup/filters/filter-store/query-store';
import { createGroupedSoupQueries } from '@app/component/next-soup/soup-view/create-grouped-soup-queries';
import { createSearchState } from '@app/component/next-soup/soup-view/create-search-state';
import { deduplicateEntities } from '@app/component/next-soup/utils';
import { useEntryState } from '@app/component/split-layout/entry-state';
import { useSplitPanelOrThrow } from '@app/component/split-layout/layoutUtils';
import {
  isListViewID,
  type ListView,
  soupItemMatchesListView,
} from '@app/constants/list-views';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  ENABLE_FEATURED_SEARCH_RESULTS,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG,
  ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
} from '@core/constant/featureFlags';
import { useUserId } from '@core/context/user';
import {
  type EntityData,
  getPropertyOptionLabel,
  isWithNotification,
  toNotificationEntity,
} from '@entity';
import { useNotificationsForEntity } from '@notifications';
import { useQueryClient } from '@queries/client';
import type {
  GroupMeta as ApiGroupMeta,
  GroupByField,
} from '@queries/soup/grouped/types';
import type { SoupParams } from '@queries/soup/items';
import { useSoupAstItemsQuery } from '@queries/soup/items';
import { soupKeys } from '@queries/soup/keys';
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
  onCleanup,
  type Setter,
  Suspense,
  useContext,
} from 'solid-js';
import { unwrap } from 'solid-js/store';

type DataSource<T> = {
  data: Accessor<T[]>;
  isLoading: Accessor<boolean>;
  isFetching: Accessor<boolean>;
  /**
   * True while the query is showing placeholder data from a previous query
   * key (e.g. the prior tab's rows) and fetching the real results. Used to
   * surface a loading indicator when switching between soup tabs.
   */
  isPlaceholderData: Accessor<boolean>;
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
  items: Accessor<SoupEntity[]>;
  rows: Accessor<SoupRow[]>;
  isSearchServiceLoading: Accessor<boolean>;
  isLocalSearchSettling: Accessor<boolean>;
  queryFilters: QueryStore;
  assigneeFilter: Accessor<string[]>;
  setAssigneeFilter: Setter<string[]>;
  inboxFilter: Accessor<string[] | undefined>;
  setInboxFilter: Setter<string[] | undefined>;
  activeTab: Accessor<string | undefined>;
  setActiveTab: Setter<string | undefined>;
  groupByField: Accessor<GroupByField | undefined>;
  fetchNextGroupPage: (groupKey: string) => Promise<void>;
  isFetchingGroupPage: (groupKey: string) => boolean;
  hasNextGroupPage: (groupKey: string) => boolean;
}

const SoupViewContext = createContext<SoupViewContextValues>();

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

  const panel = useSplitPanelOrThrow();

  // Restore filter state from this history entry if it was captured during a
  // previous nav-away; otherwise fall back to the caller-provided initial.
  const persistedFilters = panel.handle.currentEntryState()?.[
    'search.filters'
  ] as Query | undefined;
  const store = createQueryStore({
    initial: persistedFilters ?? props.initialQuery,
  });

  const filterCaptorTeardown = panel.handle.registerEntryStateCaptor(
    'search.filters',
    () => structuredClone(unwrap(store.state)) as Query
  );
  onCleanup(filterCaptorTeardown);

  // Client-side predicate state (drives the "Type: X" chips and other
  // toggleable filters) also needs to round-trip per entry, since the chip UI
  // reads predicates directly and would otherwise show empty after back-nav.
  const persistedPredicates = panel.handle.currentEntryState()?.[
    'search.predicates'
  ] as SetPredicatesInput<string> | undefined;
  if (persistedPredicates) {
    soup.predicates.set(persistedPredicates);
  }
  const predicatesCaptorTeardown = panel.handle.registerEntryStateCaptor(
    'search.predicates',
    (): SetPredicatesInput<string> => ({
      and: [...soup.predicates.andIds()],
      or: [...soup.predicates.orIds()],
    })
  );
  onCleanup(predicatesCaptorTeardown);

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
  const [assigneeFilter, setAssigneeFilter] = useEntryState<string[]>(
    'soup.assigneeFilter',
    { default: [] }
  );
  const [inboxFilter, setInboxFilter] = useEntryState<string[] | undefined>(
    'soup.inboxFilter',
    { default: undefined }
  );
  const [activeTab, setActiveTab] = useEntryState<string | undefined>(
    'soup.tab',
    { default: undefined }
  );

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

  const applyInboxFilter = (state: QueryState): QueryState => {
    const inboxes = inboxFilter();
    if (inboxes === undefined) return state;
    return {
      ...state,
      include: {
        ...state.include,
        emailLinkId: inboxes.length ? inboxes : [NIL_UUID],
      },
    };
  };

  const soupBody = createMemo(() =>
    compileToAst(applyInboxFilter(queryFilters.state))
  );

  const [searchText, setSearchText] = useEntryState<string>('search.text', {
    default: props.initialSearchText ?? '',
  });

  const search = createSearchState({
    soup,
    filters: () => applyInboxFilter(queryFilters.state),
    assignees: assigneeFilter,
    disableLocalSearch: props.disableLocalSearch,
    searchPaused,
    searchText,
    setSearchText,
  });

  const notificationSource = useGlobalNotificationSource();
  const userId = useUserId();
  const showSupportedForeignEntitiesFF = useFeatureFlag(
    ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_FLAG,
    {
      enabledOverride: ENABLE_SUPPORTED_SOUP_FOREIGN_ENTITIES_OVERRIDE,
    }
  );

  // Create filter context for context-aware filter predicates
  const getFilterContext = (): FilterContext => ({
    userId: userId(),
    notificationSource,
    assignees: assigneeFilter(),
  });

  const attachNotifications = (entity: EntityData) => {
    return {
      ...entity,
      notifications: useNotificationsForEntity(
        notificationSource,
        toNotificationEntity(entity)
      ),
    };
  };

  const activeListView = createMemo<ListView | undefined>(() => {
    const content = panel.handle.content();
    if (content.type !== 'component') return;
    return isListViewID(content.id) ? content.id : undefined;
  });

  const itemsQuery = useSoupAstItemsQuery(
    () => ({
      params: soupParams(),
      body: soupBody(),
      groupBy: groupByField(),
    }),
    () => {
      const view = activeListView();
      return {
        enabled: !search.isSearching(),
        showSupportedForeignEntities: showSupportedForeignEntitiesFF().enabled,
        meta: {
          itemFilter: (item) => soupItemMatchesListView(item, view),
        },
      };
    }
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

  const groupQueries = createGroupedSoupQueries({
    initialPage: () => {
      const groups = itemsQuery.data?.groups;
      const items = itemsQuery.data?.itemsById;
      if (!groups || !items) return;
      return { groups, items };
    },
    groupByField,
    soupParams,
    soupBody,
    queryOptions: () => {
      const view = activeListView();
      return {
        enabled: !search.isSearching(),
        meta: {
          itemFilter: (item) => soupItemMatchesListView(item, view),
        },
      };
    },
  });

  const groupQueryFor = (groupKey: string) => groupQueries.map().get(groupKey);

  const fetchNextGroupPage = async (groupKey: string) => {
    await groupQueryFor(groupKey)?.fetchNextPage();
  };

  const isFetchingGroupPage = (groupKey: string) =>
    groupQueryFor(groupKey)?.isFetchingNextPage() ?? false;

  const hasNextGroupPage = (groupKey: string) =>
    groupQueryFor(groupKey)?.hasNextPage() ?? false;

  const buildGroupMeta = (group: ApiGroupMeta): GroupMeta => {
    const resolvedLabel = getPropertyOptionLabel(group.key) ?? group.label;
    return {
      key: group.key,
      value: group.key,
      label: resolvedLabel,
      count: group.totalCount,
      isExpanded: () => soup.grouping.isExpanded(group.key),
      toggle: () => soup.grouping.toggle(group.key),
    };
  };

  const rows = createMemo((): SoupRow[] => {
    const field = groupByField();
    const groups = itemsQuery.data?.groups;

    if (!field || !groups || search.isSearching()) {
      return entities().map((entity, index) =>
        soup.buildRow({ id: entity.id, index, original: entity })
      );
    }

    const result: SoupRow[] = [];
    let globalIndex = 0;

    for (const apiGroup of groups) {
      const groupMeta = buildGroupMeta(apiGroup);
      const groupData = groupQueryFor(apiGroup.key)?.data();
      const groupEntities =
        groupData?.entities.map(
          (entity) =>
            (isWithNotification(entity)
              ? entity
              : attachNotifications(entity)) as SoupEntity
        ) ?? [];

      const firstEntity = groupEntities[0];
      if (!firstEntity) continue;

      result.push(
        soup.buildRow({
          id: `header:${apiGroup.key}`,
          index: globalIndex++,
          original: firstEntity,
          group: groupMeta,
          isGrouped: true,
        })
      );

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

      if (!hasNextGroupPage(apiGroup.key)) continue;

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

  const { searchQuery } = search;

  const context = {
    soup,
    source: {
      data: entities,
      isLoading: () => itemsQuery.isLoading,
      isFetching: () => itemsQuery.isFetching || searchQuery.isFetching,
      isPlaceholderData: () =>
        itemsQuery.isPlaceholderData && !search.isSearching(),
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
    items,
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
    inboxFilter,
    setInboxFilter,
    activeTab,
    setActiveTab,
    groupByField,
    fetchNextGroupPage,
    isFetchingGroupPage,
    hasNextGroupPage,
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
