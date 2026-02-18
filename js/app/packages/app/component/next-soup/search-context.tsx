import { throttledDependent } from '@core/util/debounce';
import type { EntityData } from '@entity';
import {
  type SoupItemsQueryArgs,
  useSoupItemsQuery,
} from '@queries/soup/items';
import { EXCLUDE } from '@app/component/next-soup/filters/filters';
import {
  type Accessor,
  createContext,
  createDeferred,
  createMemo,
  type FlowComponent,
  useContext,
} from 'solid-js';
import { throttle } from '@solid-primitives/scheduled';

export const DEFAULT_SEARCH_SORT = 'updated_at';

const CHANNEL_PRELOAD_ARGS: SoupItemsQueryArgs = {
  params: { limit: 500, sort_method: DEFAULT_SEARCH_SORT },
  body: {
    chat_filters: { chat_ids: EXCLUDE },
    document_filters: { document_ids: EXCLUDE },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: EXCLUDE },
    channel_filters: { channel_ids: [] },
  },
};

const ITEM_PRELOAD_ARGS: SoupItemsQueryArgs = {
  params: { limit: 500, sort_method: DEFAULT_SEARCH_SORT },
  body: {
    chat_filters: { chat_ids: [] },
    document_filters: { document_ids: [] },
    email_filters: { recipients: EXCLUDE },
    project_filters: { project_ids: [] },
    channel_filters: { channel_ids: EXCLUDE },
  },
};

interface SearchContextValue {
  entityPool: Accessor<EntityData[]>;
}

const SearchContext = createContext<SearchContextValue>();

export const useSearchContext = () => {
  const context = useContext(SearchContext);
  if (!context) {
    throw new Error('useSearchContext can only be used under a SearchProvider');
  }
  return context;
};

export const SearchProvider: FlowComponent = (props) => {
  const itemsQuery = useSoupItemsQuery(() => ITEM_PRELOAD_ARGS);
  const itemsFetchNextPage = throttle(() => itemsQuery.fetchNextPage(), 2000);
  createDeferred(() => {
    if (itemsQuery.hasNextPage && !itemsQuery.isFetchingNextPage) {
      itemsFetchNextPage();
    }
  });

  const channelItemsQuery = useSoupItemsQuery(() => CHANNEL_PRELOAD_ARGS);
  const channelItemsFetchNextPage = throttle(
    () => channelItemsQuery.fetchNextPage(),
    2000
  );
  createDeferred(() => {
    if (
      channelItemsQuery.hasNextPage &&
      !channelItemsQuery.isFetchingNextPage
    ) {
      channelItemsFetchNextPage();
    }
  });

  const itemsQueryData = throttledDependent(() => itemsQuery.data ?? [], 5000);
  const channelItemsQueryData = throttledDependent(
    () => channelItemsQuery.data ?? [],
    5000
  );

  const entityPool = createMemo<EntityData[]>(() => [
    ...itemsQueryData(),
    ...channelItemsQueryData(),
  ]);

  return (
    <SearchContext.Provider value={{ entityPool }}>
      {props.children}
    </SearchContext.Provider>
  );
};
