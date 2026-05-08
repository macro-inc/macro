import { createInfiniteQuery, type InfiniteData } from '@tanstack/solid-query';
import { type Accessor, createMemo, mapArray } from 'solid-js';

type InfiniteQueryConfig<TData, TSelect = TData[]> = {
  key: string;
  queryKey: readonly unknown[];
  queryFn: (ctx: { pageParam: string | null }) => Promise<TData>;
  getNextPageParam: (lastPage: TData) => string | null;
  initialData?: { pages: TData[]; pageParams: (string | null)[] };
  select?: (pages: TData[]) => TSelect;
  enabled?: boolean;
  staleTime?: number;
};

type InfiniteQueryResult<TSelect> = {
  key: string;
  data: Accessor<TSelect | undefined>;
  hasNextPage: Accessor<boolean>;
  isFetchingNextPage: Accessor<boolean>;
  fetchNextPage: () => void;
};

export function createInfiniteQueries<TData, TSelect = TData[]>(
  getConfigs: Accessor<InfiniteQueryConfig<TData, TSelect>[]>
): Accessor<InfiniteQueryResult<TSelect>[]> {
  const queries = mapArray(
    () => getConfigs().map((c) => c.key),
    (key): InfiniteQueryResult<TSelect> => {
      const getConfig = createMemo(() => getConfigs().find((c) => c.key === key));

      const query = createInfiniteQuery(() => {
        const config = getConfig();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const options: any = {
          queryKey: config?.queryKey ?? (['__disabled__', key] as const),
          queryFn: async (ctx: { pageParam: string | null }) => {
            if (!config) return null;
            return config.queryFn({ pageParam: ctx.pageParam });
          },
          initialPageParam: null as string | null,
          getNextPageParam: (lastPage: TData) => config?.getNextPageParam(lastPage) ?? null,
          enabled: config?.enabled ?? false,
          staleTime: config?.staleTime ?? Infinity,
        };

        if (config?.initialData) {
          options.initialData = config.initialData;
        }

        if (config?.select) {
          options.select = (data: InfiniteData<TData>) => config.select!(data.pages);
        }

        return options;
      });

      return {
        key,
        data: () => {
          const config = getConfig();
          if (config?.select) {
            return query.data as TSelect | undefined;
          }
          return (query.data as InfiniteData<TData> | undefined)?.pages as TSelect | undefined;
        },
        hasNextPage: () => query.hasNextPage ?? false,
        isFetchingNextPage: () => query.isFetchingNextPage,
        fetchNextPage: () => query.fetchNextPage(),
      };
    }
  );

  return queries;
}
