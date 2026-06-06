import {
  createInfiniteQuery,
  type InfiniteData,
  type InfiniteQueryObserverResult,
} from '@tanstack/solid-query';
import { type Accessor, createMemo, mapArray } from 'solid-js';

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
};

type InfiniteQueriesResult<TData, TSelect> = {
  list: Accessor<InfiniteQueryResult<TData, TSelect>[]>;
  map: Accessor<Map<string, InfiniteQueryResult<TData, TSelect>>>;
};

export function createInfiniteQueries<TData, TSelect = TData[]>(
  getConfigs: Accessor<InfiniteQueryConfig<TData, TSelect>[]>
): InfiniteQueriesResult<TData, TSelect> {
  const queries = mapArray(
    () => getConfigs().map((c) => c.key),
    (key): InfiniteQueryResult<TData, TSelect> => {
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
          queryFn: async (ctx) => {
            if (!config) return null;
            return config.queryFn({ pageParam: ctx.pageParam });
          },
          initialPageParam: null,
          getNextPageParam: (lastPage) =>
            lastPage ? (config?.getNextPageParam(lastPage) ?? null) : null,
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
      };
    }
  );

  const queriesByKey = createMemo(() => {
    const map = new Map<string, InfiniteQueryResult<TData, TSelect>>();
    for (const query of queries()) {
      map.set(query.key, query);
    }
    return map;
  });

  return { list: queries, map: queriesByKey };
}
