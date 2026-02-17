import { useGlobalNotificationSource } from '@app/component/GlobalAppState';
import {
  createSoupState,
  type SoupState,
} from '@app/component/next-soup/create-soup-state';
import { createSearchState } from '@app/component/next-soup/soup-view/create-search-state';
import { sortEntitiesForSearch } from '@app/component/next-soup/soup-view/sort-options';
import { deduplicateEntities } from '@app/component/next-soup/utils';
import type { EntityData, WithNotification, WithSearch } from '@entity';
import { isWithNotification } from '@entity';
import { useNotificationsForEntity } from '@notifications';
import type { SoupItemsQueryFilters } from '@queries/soup/items';
import {
  type Accessor,
  createContext,
  createMemo,
  createRenderEffect,
  createSignal,
  type FlowComponent,
  on,
  type Setter,
  Suspense,
  useContext,
} from 'solid-js';

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
  isSearchDisabled: Accessor<boolean>;
  rows: Accessor<SoupRow[]>;
  queryFilters: Accessor<SoupItemsQueryFilters>;
  setQueryFilters: Setter<SoupItemsQueryFilters>;
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

  const [internalQueryFilters, setQueryFilters] =
    createSignal<SoupItemsQueryFilters>({});

  const queryFilters = createMemo(() => {
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

  const items = createMemo<SoupEntity[]>(
    (prev) => {
      const searching = search.isSearching();

      if (!searching) {
        const data = search.itemsQuery.data;
        if (!data) return prev;
        return data.map((e) =>
          isWithNotification(e) ? e : attachNotifications(e)
        ) as SoupEntity[];
      }

      const local = search.localFuzzyResults();
      const service = search.freshSearchResults();

      const merged: SoupEntity[] = [...service, ...local];

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

  const entities = () => {
    const filters = soup.filters.active();
    let transformed = items();

    const next = [];

    for (const entity of transformed) {
      if (!filters.every((f) => f.predicate(entity))) {
        continue;
      }

      next.push(entity);
    }

    transformed = deduplicateEntities(next);

    if (search.isSearching()) {
      transformed.sort(sortEntitiesForSearch);
    }

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

  const rows = createMemo(() => {
    return entities().map((e) => attachMethods(e));
  });

  const { itemsQuery, searchQuery } = search;

  const context = {
    soup,
    source: {
      data: entities,
      isLoading: () => {
        if (itemsQuery.isLoading) return true;
        if (searchQuery.isLoading && !itemsQuery.data) return true;
        return false;
      },
      isFetching: () => searchQuery.isFetching || itemsQuery.isFetching,
      isFetchingNextPage: () =>
        searchQuery.isFetchingNextPage || itemsQuery.isFetchingNextPage,
      hasNextPage: () => {
        return (
          (searchQuery.isEnabled && searchQuery.hasNextPage) ||
          (itemsQuery.isEnabled && itemsQuery.hasNextPage)
        );
      },
      fetchNextPage: () => {
        if (searchQuery.isEnabled) {
          searchQuery.fetchNextPage();
        }

        if (itemsQuery.isEnabled) {
          itemsQuery.fetchNextPage();
        }
      },
    },
    rows,
    searchText: search.searchText,
    setSearchText: search.setSearchText,
    isSearchDisabled: search.isSearchDisabled,
    queryFilters,
    setQueryFilters,
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
