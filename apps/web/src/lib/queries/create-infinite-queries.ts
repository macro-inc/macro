import {
  createInfiniteQuery,
  type InfiniteData,
  type InfiniteQueryObserverResult,
  type QueryObserverResult,
} from '@tanstack/solid-query';
import {
  type Accessor,
  createComputed,
  createMemo,
  createRoot,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

type InfiniteQueryConfig<TData, TSelect = TData[]> = {
  key: string;
  queryKey: readonly unknown[];
  queryFn: (ctx: { pageParam: string | null }) => Promise<TData>;
  getNextPageParam: (lastPage: TData) => string | null;
  initialData?: InfiniteData<TData, string | null>;
  placeholderData?: InfiniteData<TData, string | null>;
  select?: (pages: TData[]) => TSelect;
  enabled?: boolean;
  staleTime?: number;
  meta?: Record<string, unknown>;
};

type InfiniteQueryResult<TData, TSelect> = {
  key: string;
  data: Accessor<TSelect | undefined>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  fetchNextPage: () => Promise<
    InfiniteQueryObserverResult<
      InfiniteData<TData | null, string | null>,
      Error
    >
  >;
  refetch: () => Promise<
    QueryObserverResult<InfiniteData<TData | null, string | null>, Error>
  >;
};

type InfiniteQueriesResult<TData, TSelect> = {
  list: Accessor<InfiniteQueryResult<TData, TSelect>[]>;
  map: Accessor<Map<string, InfiniteQueryResult<TData, TSelect>>>;
};

type PageParam = string | null;

// Cached callbacks outlive the per-key root. They wrap only the caller's
// function values, never the config lookup or this helper's scope.
function wrapQueryFn<TData>(
  queryFn: InfiniteQueryConfig<TData, unknown>['queryFn'] | undefined
) {
  return async (ctx: { pageParam: PageParam }): Promise<TData | null> =>
    queryFn ? queryFn({ pageParam: ctx.pageParam }) : null;
}

function wrapGetNextPageParam<TData>(
  getNextPageParam:
    | InfiniteQueryConfig<TData, unknown>['getNextPageParam']
    | undefined
) {
  return (lastPage: TData | null): PageParam =>
    lastPage ? (getNextPageParam?.(lastPage) ?? null) : null;
}

export function createInfiniteQueries<TData, TSelect = TData[]>(
  getConfigs: Accessor<InfiniteQueryConfig<TData, TSelect>[]>
): InfiniteQueriesResult<TData, TSelect> {
  type StoredQuery = InfiniteQueryResult<TData, TSelect> & {
    dispose: () => void;
  };

  const queryByKey = new Map<string, StoredQuery>();
  const [revision, setRevision] = createSignal(0);

  const createQuery = (key: string): StoredQuery => {
    let dispose: (() => void) | undefined;

    const queryResult = createRoot((rootDispose) => {
      dispose = rootDispose;

      const getConfig = createMemo(() =>
        getConfigs().find((c) => c.key === key)
      );

      const getSelect = createMemo(() => getConfig()?.select);

      const query = createInfiniteQuery<
        TData | null,
        Error,
        InfiniteData<TData | null, string | null>,
        readonly unknown[],
        string | null
      >(() => {
        const config = getConfig();

        return {
          queryKey: config?.queryKey ?? (['__disabled__', key] as const),
          queryFn: wrapQueryFn<TData>(config?.queryFn),
          initialPageParam: null,
          getNextPageParam: wrapGetNextPageParam<TData>(
            config?.getNextPageParam
          ),
          enabled: config?.enabled ?? false,
          staleTime: config?.staleTime ?? Infinity,
          initialData: config?.initialData as InfiniteData<
            TData | null,
            string | null
          >,
          placeholderData: config?.placeholderData as InfiniteData<
            TData | null,
            string | null
          >,
          meta: config?.meta,
        };
      });

      const data = () => {
        const pages = query.data?.pages.filter((p): p is TData => p !== null);
        if (!pages) return undefined;
        const select = getSelect();
        if (select) {
          return select(pages);
        }
        return pages as TSelect;
      };

      return {
        key,
        data,
        hasNextPage: () => query.hasNextPage ?? false,
        isFetchingNextPage: () => query.isFetchingNextPage,
        fetchNextPage: () => query.fetchNextPage(),
        refetch: () => query.refetch(),
      };
    });

    return {
      ...queryResult,
      dispose: () => dispose?.(),
    };
  };

  createComputed(
    on(
      () => getConfigs().map((c) => c.key),
      (keys) => {
        const activeKeys = new Set(keys);
        let changed = false;

        for (const [key, query] of queryByKey) {
          if (!activeKeys.has(key)) {
            query.dispose();
            queryByKey.delete(key);
            changed = true;
          }
        }

        for (const key of keys) {
          if (!queryByKey.has(key)) {
            queryByKey.set(key, createQuery(key));
            changed = true;
          }
        }

        if (changed) setRevision((value) => value + 1);
      }
    )
  );

  onCleanup(() => {
    for (const query of queryByKey.values()) query.dispose();
    queryByKey.clear();
  });

  const queries = createMemo(() => {
    revision();
    return getConfigs()
      .map((config) => queryByKey.get(config.key))
      .filter((query): query is StoredQuery => Boolean(query));
  });

  const queriesByKey = createMemo(() => {
    const map = new Map<string, InfiniteQueryResult<TData, TSelect>>();
    for (const query of queries()) {
      map.set(query.key, query);
    }
    return map;
  });

  return { list: queries, map: queriesByKey };
}
