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
  createSignal,
  type FlowComponent,
  useContext,
  createEffect,
  onCleanup,
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

/**
 * Create a throttled view of an array signal that passes through all values
 * immediately until the first non-empty array, then switches to a fixed
 * interval that flushes the latest value every `delay` ms.
 */
function lazyThrottle<T extends unknown[]>(
  source: () => T,
  delay: number
): Accessor<T> {
  const [value, setValue] = createSignal<T>(source());
  let received = false;
  let latest: T;
  let interval: ReturnType<typeof setInterval> | undefined;

  createEffect(() => {
    latest = source();
    if (!received) {
      setValue(() => latest);
      if (latest.length > 0) {
        received = true;
        interval = setInterval(() => setValue(() => latest), delay);
      }
    }
  });

  onCleanup(() => clearInterval(interval));
  return value;
}

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

  const itemsQueryData = lazyThrottle(() => itemsQuery.data ?? [], 5000);
  const channelItemsQueryData = lazyThrottle(
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
