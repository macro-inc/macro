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
import { useQueryClient } from '@queries/client';
import { soupKeys } from '@queries/soup/keys';
import type { InfiniteData } from '@tanstack/solid-query';
import type { SoupPage } from '@service-storage/generated/schemas';

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
  queryFilters: Accessor<SoupBody>;
  setQueryFilters: Setter<SoupBody>;
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
  queryFilters?: SoupBody;
  disableLocalSearch?: boolean;
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

  const [internalQueryFilters, setInternalQueryFilters] =
    createSignal<SoupBody>({ ...(props.queryFilters ?? {}) });

  const [assigneeFilter, setAssigneeFilter] = createSignal<string[]>([]);
  const [activeTab, setActiveTab] = createSignal<string | undefined>(undefined);

  // Clear sub-filters when task filter is deactivated
  createEffect(() => {
    if (!soup.filters.isActive('task')) {
      setAssigneeFilter([]);
    }
  });

  const queryFilters = createMemo(() => {
    const base = internalQueryFilters();

    return {
      ...base,
    };
  });

  const soupBody = createMemo(
    (): SoupBody => ({
      ...queryFilters(),
    })
  );

  const search = createSearchState({
    soup,
    queryFilters,
    disableLocalSearch: props.disableLocalSearch,
  });

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

  const setQueryFilters: Setter<SoupBody> = (next) => {
    // To avoid fetching all pages again when coming back to the current query filters,
    // we set the query cache to only contain the first page of data which is the only
    // one to be refetched
    queryClient.setQueryData(
      soupKeys.items({
        params: soupParams(),
        body: soupBody(),
      }).queryKey,
      (prev: InfiniteData<SoupPage> | SoupPage) => {
        if (!prev) return;

        if ('pages' in prev) {
          // Just to avoid spreading and new array creation, works the same but slightly
          // better performance
          prev.pages.splice(1, prev.pages.length);
          return prev;
        }

        return prev;
      }
    );

    setInternalQueryFilters(next);
  };

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
    let transformed = items();

    const next = [];

    const currentAssigneeFilter = assigneeFilter();

    for (const entity of transformed) {
      if (!soup.filters.test(entity)) {
        continue;
      }

      // Apply task sub-filters
      if (currentAssigneeFilter.length > 0 && isTaskEntity(entity)) {
        const taskEntity = entity as unknown as TaskEntityWithProperties;
        if (
          !matchesTaskSubFilters(taskEntity, {
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
    assigneeFilter,
    setAssigneeFilter,
    activeTab,
    setActiveTab,
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
