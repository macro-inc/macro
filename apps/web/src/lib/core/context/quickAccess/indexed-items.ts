import type {
  CacheHost,
  EntityIndexCursor,
  IndexedEntityBucket,
} from '@graphql-cache/index';
import {
  createInfiniteQuery,
  type InfiniteData,
  keepPreviousData,
} from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';
import { indexedEntityToQuickAccessItem } from './graphql-items';
import type { EntityItem } from './types';

export type IndexedQuickAccessPage = {
  items: EntityItem[];
  nextCursor: EntityIndexCursor | undefined;
  hasMore: boolean;
  totalCount: number | undefined;
  bucketCounts: Partial<Record<IndexedEntityBucket, number>> | undefined;
};

type IndexedQuickAccessPageCursor = EntityIndexCursor | null;

/** Shared prefix for cache-backed Quick Access queries. */
export const QUICK_ACCESS_INDEX_QUERY_KEY = [
  'quick-access',
  'entity-index',
] as const;

function mapIndexedItems(
  items: Awaited<ReturnType<CacheHost['queryIndexedItems']>>['items']
): EntityItem[] {
  return items.flatMap((item) => {
    const mapped = indexedEntityToQuickAccessItem(item);
    return mapped ? [mapped] : [];
  });
}

/** Reads and maps one browse or search page from the durable entity index. */
export async function queryIndexedQuickAccessPage(
  cacheHost: Pick<CacheHost, 'queryIndexedItems'>,
  options: {
    buckets: IndexedEntityBucket[];
    searchTerm?: string;
    cursor?: EntityIndexCursor;
    limit: number;
    includeTotalCount?: boolean;
  }
): Promise<IndexedQuickAccessPage> {
  const { searchTerm, cursor, ...common } = options;
  const page = await cacheHost.queryIndexedItems({
    ...common,
    ...(searchTerm ? { searchTerm } : {}),
    cursor,
  });
  return {
    items: mapIndexedItems(page.items),
    nextCursor: page.nextCursor ?? undefined,
    hasMore: page.hasMore,
    totalCount: page.totalCount ?? undefined,
    bucketCounts: page.bucketCounts ?? undefined,
  };
}

/**
 * Creates a cache-backed entity query whose key follows the reactive search
 * arguments while the query observer itself remains stable.
 */
export function createIndexedQuickAccessQuery(options: {
  cacheHost: Accessor<CacheHost | undefined>;
  buckets: Accessor<IndexedEntityBucket[]>;
  searchTerm: Accessor<string>;
  enabled: Accessor<boolean>;
  pageSize: Accessor<number>;
}) {
  return createInfiniteQuery<
    IndexedQuickAccessPage,
    Error,
    InfiniteData<IndexedQuickAccessPage, IndexedQuickAccessPageCursor>,
    readonly unknown[],
    IndexedQuickAccessPageCursor
  >(() => {
    const query = options.searchTerm();
    const buckets = options.buckets();
    const pageSize = options.pageSize();
    const cacheHost = options.cacheHost();

    return {
      queryKey: [
        ...QUICK_ACCESS_INDEX_QUERY_KEY,
        'search',
        query,
        pageSize,
        ...buckets,
      ],
      queryFn: ({ pageParam }) => {
        if (!cacheHost) {
          return Promise.resolve({
            items: [],
            nextCursor: undefined,
            hasMore: false,
            totalCount: 0,
            bucketCounts: {},
          });
        }
        return queryIndexedQuickAccessPage(cacheHost, {
          buckets,
          searchTerm: query || undefined,
          cursor: pageParam ?? undefined,
          limit: pageSize,
          includeTotalCount: pageParam === null,
        });
      },
      initialPageParam: null,
      getNextPageParam: (lastPage) =>
        lastPage.hasMore ? (lastPage.nextCursor ?? null) : null,
      enabled:
        options.enabled() && cacheHost !== undefined && buckets.length > 0,
      placeholderData: keepPreviousData,
      staleTime: Infinity,
    };
  });
}
