import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  createSoupState,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import { createSearchState } from '@app/component/next-soup/soup-view/create-search-state';
import { deduplicateEntities } from '@app/component/next-soup/utils';
import {
  isTaskEntity,
  isWithNotification,
  type EntityData,
  type TaskEntityWithProperties,
  type WithNotification,
  type WithSearch,
} from '@entity';
import { ENABLE_FEATURED_SEARCH_RESULTS } from '@core/constant/featureFlags';
import { useNotificationsForEntity } from '@notifications';
import {
  type SoupParams,
  useSoupItemsQuery,
  type SoupItemsQueryFilters,
  type SoupBody,
} from '@queries/soup/items';
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
import { matchesTaskSubFilters } from './task-sub-filter-matcher';

type Row<T> = {
  original: T;
  id: string;
  depth: number;
  isSelected: () => boolean;
  isExpanded: () => boolean;
  isGrouped: () => boolean;
  isFocused: () => boolean;
  toggleExpanded: (expanded?: boolean) => void;
};

export type SoupRow = Row<SoupEntity>;

export type SoupEntity = WithNotification<EntityData | WithSearch<EntityData>>;

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
  featuredIds: Accessor<string[]>;
  rows: Accessor<SoupRow[]>;
  isSearchServiceLoading: Accessor<boolean>;
  isLocalSearchSettling: Accessor<boolean>;
  queryFilters: Accessor<SoupItemsQueryFilters>;
  setQueryFilters: Setter<SoupItemsQueryFilters>;
  statusFilter: Accessor<string | undefined>;
  setStatusFilter: Setter<string | undefined>;
  assigneeFilter: Accessor<string | undefined>;
  setAssigneeFilter: Setter<string | undefined>;
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
  queryFilters?: SoupItemsQueryFilters;
}

export const SoupViewContextProvider: FlowComponent<
  SoupViewContextProviderProps
> = (props) => {
  const soup = props.soup ?? createSoupState();

  const soupParams = createMemo(
    (): SoupParams => ({
      limit: 100,
      sort_method: soup.sort.active()[0]?.id ?? 'updated_at',
    })
  );

  const [internalQueryFilters, setQueryFilters] =
    createSignal<SoupItemsQueryFilters>({});

  const [statusFilter, setStatusFilter] = createSignal<string | undefined>();
  const [assigneeFilter, setAssigneeFilter] = createSignal<
    string | undefined
  >();

  // Clear sub-filters when task filter is deactivated
  createEffect(() => {
    if (!soup.filters.isActive('task')) {
      setStatusFilter(undefined);
      setAssigneeFilter(undefined);
    }
  });

  const queryFilters = createMemo((): SoupItemsQueryFilters => {
    const base = internalQueryFilters();

    return {
      ...base,
      ...props.queryFilters,
      channel_filters: {
        ...base.channel_filters,
        ...props.queryFilters?.channel_filters,
      },
      chat_filters: {
        ...base.chat_filters,
        ...props.queryFilters?.chat_filters,
      },
      document_filters: {
        ...base.document_filters,
        ...props.queryFilters?.document_filters,
      },
      email_filters: {
        ...base.email_filters,
        ...props.queryFilters?.email_filters,
      },
      project_filters: {
        ...base.project_filters,
        ...props.queryFilters?.project_filters,
      },
    };
  });

  const soupBody = createMemo(
    (): SoupBody => ({
      ...queryFilters(),
      emailView: 'all',
    })
  );

  const search = createSearchState({ soup, queryFilters });

  const notificationSource = useGlobalNotificationSource();

  const attachNotifications = (entity: EntityData) => {
    return {
      ...entity,
      notifications: useNotificationsForEntity(notificationSource, entity),
    };
  };

  const attachMethods = (
    entity: WithNotification<EntityData>,
    depth = 0
  ): SoupRow => {
    return {
      original: entity,
      id: entity.id,
      depth,
      isFocused() {
        return soup.focus.id() === entity.id;
      },
      isSelected() {
        return soup.selection.isSelected(entity.id);
      },
      isGrouped() {
        return false;
      },
      isExpanded() {
        return soup.selection.isSelected(entity.id);
      },
      toggleExpanded() {
        return soup.selection.isSelected(entity.id);
      },
    };
  };

  const itemsQuery = useSoupItemsQuery(
    () => ({
      params: soupParams(),
      body: soupBody(),
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
        return data.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];
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
    const filters = soup.filters.active();
    let transformed = items();

    const next = [];

    const currentStatusFilter = statusFilter();
    const currentAssigneeFilter = assigneeFilter();

    for (const entity of transformed) {
      if (!filters.every((f) => f.predicate(entity))) {
        continue;
      }

      // Apply task sub-filters
      if (
        (currentStatusFilter || currentAssigneeFilter) &&
        isTaskEntity(entity)
      ) {
        const taskEntity = entity as unknown as TaskEntityWithProperties;
        if (
          !matchesTaskSubFilters(taskEntity, {
            statusFilter: currentStatusFilter,
            assigneeFilter: currentAssigneeFilter,
          })
        ) {
          continue;
        }
      }

      next.push(entity);
    }

    transformed = deduplicateEntities(next);

    const sorts = soup.sort.active();
    if (sorts.length > 0) {
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
    return entities().map((e) => attachMethods(e));
  });

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
    featuredIds: search.featuredIds,
    isSearchServiceLoading: search.isSearchServiceLoading,
    isLocalSearchSettling: search.isLocalSearchSettling,
    queryFilters,
    setQueryFilters,
    statusFilter,
    setStatusFilter,
    assigneeFilter,
    setAssigneeFilter,
  };

  return (
    <SoupViewContext.Provider value={context}>
      {props.children}
      <Suspense>
        <SyncWithSoup soup={soup} entities={entities()} />
      </Suspense>
    </SoupViewContext.Provider>
  );
};

interface SyncWithSoupProps {
  soup: SoupState;
  entities: SoupEntity[];
}

const SyncWithSoup = (props: SyncWithSoupProps) => {
  createRenderEffect(on(() => props.entities, props.soup.setData));

  return null;
};
