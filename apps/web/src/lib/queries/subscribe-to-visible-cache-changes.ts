import type { CacheHost } from '@graphql-cache/host/types';
import { type Accessor, untrack } from 'solid-js';
import { createVisibleRefresh } from './visible-refresh';

/**
 * Refreshes after cache changes on `createVisibleRefresh`'s terms. This does
 * not pause cache ingestion, mutations, or explicit/initial requests.
 *
 * The caller must unsubscribe on disposal.
 */
export function subscribeToVisibleCacheChanges(
  host: Pick<CacheHost, 'onCacheChanged'>,
  refresh: () => void | Promise<unknown>,
  options?: { searchBuckets: Accessor<readonly string[]> }
): () => void {
  const visibleRefresh = createVisibleRefresh(refresh);
  let disposed = false;
  const unsubscribe = host.onCacheChanged(
    (_revision, changes) => {
      if (disposed) return;
      const changedBuckets = changes?.searchChangedBuckets;
      if (options && changedBuckets !== undefined) {
        const watched = untrack(options.searchBuckets);
        if (!changedBuckets.some((bucket) => watched.includes(bucket))) return;
      }
      visibleRefresh.markDirty();
    },
    { includeHydration: true }
  );

  return () => {
    disposed = true;
    unsubscribe();
    visibleRefresh.dispose();
  };
}
