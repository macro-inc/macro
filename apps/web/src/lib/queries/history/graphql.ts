import { itemToSafeName } from '@core/constant/allBlocks';
import {
  type CacheHost,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  readRecords,
  selectRecords,
} from '@graphql-cache/index';
import {
  type GraphqlHistoryItemFieldsFragment,
  GraphqlHistoryItemFieldsFragmentDoc,
} from '@service-storage/graphql/generated/graphql';
import { getGraphqlSoupCacheHost } from '@service-storage/graphql-soup';
import { formatDocumentName } from '@service-storage/util/filename';
import { debounce } from '@solid-primitives/scheduled';
import {
  createQuery,
  keepPreviousData,
  useQueryClient,
} from '@tanstack/solid-query';
import { onCleanup } from 'solid-js';
import { fetchHistoryItems } from './history';
import { historyKeys } from './keys';
import type { DocumentHistoryItem, HistoryItem } from './types';

const CACHE_REFRESH_DEBOUNCE_MS = 250;

const graphqlHistorySelection = selectRecords(
  GraphqlHistoryItemFieldsFragmentDoc
);

type GraphqlHistoryRecord = GraphqlHistoryItemFieldsFragment;
type GraphqlDocumentHistoryRecord = Extract<
  GraphqlHistoryRecord,
  { __typename: 'GraphqlSoupDocument' }
>;

function transformDocumentSubType(
  subType: GraphqlDocumentHistoryRecord['subType']
): DocumentHistoryItem['subType'] {
  if (!subType) return subType;

  switch (subType.kind.toLowerCase()) {
    case 'task':
      return {
        type: 'task',
        is_completed: subType.isCompleted ?? false,
      };
    case 'snippet':
      return { type: 'snippet' };
    default:
      return undefined;
  }
}

/** Maps a normalized GraphQL entity projection to the legacy history shape. */
export function transformGraphqlHistoryItem(
  record: GraphqlHistoryRecord
): HistoryItem | undefined {
  switch (record.__typename) {
    case 'GraphqlSoupDocument': {
      const subType = transformDocumentSubType(record.subType);
      const safeName = itemToSafeName({
        type: 'document',
        name: record.name,
        fileType: record.fileType,
        subType,
      });
      return {
        id: record.id,
        type: 'document',
        name: formatDocumentName(safeName, record.fileType, {
          fullyQualifiedBlockName: true,
        }),
        rawName: record.name,
        ownerId: record.ownerId,
        fileType: record.fileType,
        subType,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt,
      };
    }
    case 'GraphqlSoupChat':
      return {
        id: record.id,
        type: 'chat',
        name: itemToSafeName({ type: 'chat', name: record.name }),
        rawName: record.name,
        ownerId: record.ownerId,
        isPersistent: record.isPersistent,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt,
      };
    case 'GraphqlSoupProject':
      return {
        id: record.id,
        type: 'project',
        name: itemToSafeName({ type: 'project', name: record.name }),
        rawName: record.name,
        ownerId: record.ownerId,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        deletedAt: record.deletedAt,
      };
    default:
      return undefined;
  }
}

function getSortTimestamp(record: GraphqlHistoryRecord): number {
  switch (record.__typename) {
    case 'GraphqlSoupDocument':
    case 'GraphqlSoupChat':
    case 'GraphqlSoupProject': {
      const timestamp = Date.parse(
        record.viewedAt ?? record.updatedAt ?? record.createdAt
      );
      return Number.isNaN(timestamp) ? 0 : timestamp;
    }
    default:
      return 0;
  }
}

/**
 * Reads complete document, chat, and project entity projections. The cache's
 * total record count also includes wrappers and nested normalized records.
 */
export async function readCachedGraphqlHistoryItems(
  cacheHost: Pick<CacheHost, 'readRecords'>
): Promise<HistoryItem[]> {
  const records: GraphqlHistoryRecord[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();

  do {
    const page = await readRecords(cacheHost, graphqlHistorySelection, {
      cursor,
      limit: MAX_RECORD_SELECTION_PAGE_SIZE,
    });
    records.push(...page.records);
    cursor = page.nextCursor ?? undefined;
    if (cursor) {
      if (seenCursors.has(cursor)) {
        throw new Error('cache record selection returned a repeated cursor');
      }
      seenCursors.add(cursor);
    }
  } while (cursor);

  return records
    .flatMap((record) => {
      const item = transformGraphqlHistoryItem(record);
      return item && !item.deletedAt
        ? [{ item, sortTimestamp: getSortTimestamp(record) }]
        : [];
    })
    .sort(
      (a, b) =>
        b.sortTimestamp - a.sortTimestamp || a.item.id.localeCompare(b.item.id)
    )
    .map(({ item }) => item);
}

/**
 * Returns a TanStack-compatible history query backed by normalized GraphQL
 * records, with REST history as a fallback when the cache is unavailable.
 */
export function useGraphqlHistoryQuery() {
  const cacheHost = getGraphqlSoupCacheHost();
  const normalizedCacheHost = cacheHost?.disabled ? undefined : cacheHost;
  const queryClient = useQueryClient();
  const scheduleCacheRefresh = debounce(() => {
    void queryClient.invalidateQueries({
      queryKey: historyKeys.graphqlList.queryKey,
    });
  }, CACHE_REFRESH_DEBOUNCE_MS);
  const unsubscribeCacheChanges =
    normalizedCacheHost?.onCacheChanged(scheduleCacheRefresh);

  onCleanup(() => {
    unsubscribeCacheChanges?.();
    scheduleCacheRefresh.clear();
  });

  return createQuery<HistoryItem[]>(() => ({
    queryKey: historyKeys.graphqlList.queryKey,
    queryFn: async () => {
      if (!normalizedCacheHost) return fetchHistoryItems();
      try {
        return await readCachedGraphqlHistoryItems(normalizedCacheHost);
      } catch {
        return fetchHistoryItems();
      }
    },
    placeholderData: keepPreviousData,
    staleTime: Infinity,
    refetchOnMount: 'always',
    reconcile: 'id',
  }));
}
