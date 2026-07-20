import {
  type CacheHost,
  MAX_RECORD_SELECTION_PAGE_SIZE,
  type RecordSelection,
  readRecords,
  selectRecords,
} from '@graphql-cache/index';
import {
  QuickAccessSoupItemFieldsFragmentDoc,
  type SoupItemFieldsFragment,
} from '@service-storage/graphql/generated/graphql';
import { createQuery, keepPreviousData } from '@tanstack/solid-query';
import type { Accessor } from 'solid-js';

const soupItemSelection = selectRecords(
  QuickAccessSoupItemFieldsFragmentDoc
) as RecordSelection<SoupItemFieldsFragment>;

/** Shared prefix for cache-backed Quick Access record reads. */
export const QUICK_ACCESS_RECORD_SELECTION_QUERY_KEY = [
  'quick-access',
  'record-selection',
] as const;

/** Loads complete cached non-email Soup item records. */
export async function readCachedQuickAccessRecords(
  cacheHost: Pick<CacheHost, 'readRecords'>
): Promise<SoupItemFieldsFragment[]> {
  const records: SoupItemFieldsFragment[] = [];
  let cursor: string | undefined;
  const seenCursors = new Set<string>();
  do {
    const page = await readRecords(cacheHost, soupItemSelection, {
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
  return records;
}

/** Creates the shared query that materializes cached Soup item records. */
export function createQuickAccessRecordSelectionQuery(options: {
  cacheHost: Accessor<CacheHost | undefined>;
}) {
  return createQuery<SoupItemFieldsFragment[]>(() => {
    const cacheHost = options.cacheHost();
    return {
      queryKey: QUICK_ACCESS_RECORD_SELECTION_QUERY_KEY,
      queryFn: () =>
        cacheHost
          ? readCachedQuickAccessRecords(cacheHost)
          : Promise.resolve([]),
      enabled: cacheHost !== undefined,
      placeholderData: keepPreviousData,
      staleTime: Infinity,
    };
  });
}
