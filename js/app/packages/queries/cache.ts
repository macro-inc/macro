import type { QueryClient } from '@tanstack/solid-query';

export type CachePartition<Item, Data> = {
  readonly cached: ReadonlyMap<Item, Data>;
  readonly missing: readonly Item[];
};

/**
 * Partition items into those that already have cached query data and those that don't.
 *
 * This is useful for "bulk endpoints" where you want to preserve per-item cache keys
 * but still fetch missing items in a single request.
 */
export function partitionByQueryCache<Item, Data>(args: {
  readonly queryClient: QueryClient;
  readonly items: readonly Item[];
  readonly queryKeyOf: (item: Item) => readonly unknown[];
}): CachePartition<Item, Data> {
  const cached = new Map<Item, Data>();
  const missing: Item[] = [];

  for (const item of args.items) {
    const key = args.queryKeyOf(item);
    const data = args.queryClient.getQueryData<Data>(key);
    if (data !== undefined) cached.set(item, data);
    else missing.push(item);
  }

  return { cached, missing };
}


