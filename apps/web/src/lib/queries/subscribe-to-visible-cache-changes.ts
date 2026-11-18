import type { CacheHost } from '@graphql-cache/host/types';
import { type Accessor, createEffect, on, untrack } from 'solid-js';
import { createVisibleRefresh } from './visible-refresh';

/**
 * Refreshes after cache changes on `createVisibleRefresh`'s terms. This does
 * not pause cache ingestion, mutations, or explicit/initial requests.
 *
 * With `live`, a change that arrives while it is false only marks the source
 * stale, and the source refreshes once when `live` turns true; call it under
 * an owner then.
 *
 * The caller must unsubscribe on disposal.
 */
export function subscribeToVisibleCacheChanges(
  host: Pick<CacheHost, 'onCacheChanged'>,
  refresh: () => void | Promise<unknown>,
  options?: {
    searchBuckets?: Accessor<readonly string[]>;
    includeHydration?: boolean;
    /** Minimum spacing between refreshes during a burst of changes. */
    intervalMs?: number | Accessor<number>;
    live?: Accessor<boolean>;
  }
): () => void {
  let disposed = false;
  let missed = false;
  // A refresh held back while the tab was hidden runs later, so check again.
  const visibleRefresh = createVisibleRefresh(
    () => {
      if (options?.live && !untrack(options.live)) {
        missed = true;
        return;
      }
      return refresh();
    },
    { intervalMs: options?.intervalMs }
  );
  const unsubscribe = host.onCacheChanged(
    (_revision, changes) => {
      if (disposed) return;
      const changedBuckets = changes?.searchChangedBuckets;
      if (options?.searchBuckets && changedBuckets !== undefined) {
        const watched = untrack(options.searchBuckets);
        if (!changedBuckets.some((bucket) => watched.includes(bucket))) return;
      }
      if (options?.live && !untrack(options.live)) {
        missed = true;
        return;
      }
      visibleRefresh.markDirty();
    },
    { includeHydration: options?.includeHydration ?? true }
  );
  if (options?.live) {
    createEffect(
      on(
        options.live,
        (live) => {
          if (!live || !missed || disposed) return;
          missed = false;
          visibleRefresh.markDirty();
        },
        { defer: true }
      )
    );
  }

  return () => {
    disposed = true;
    unsubscribe();
    visibleRefresh.dispose();
  };
}
