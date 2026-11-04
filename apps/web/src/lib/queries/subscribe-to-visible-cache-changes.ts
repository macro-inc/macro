import type { CacheChangeListener, CacheHost } from '@graphql-cache/host/types';
import type { CacheRevision } from '@graphql-cache/protocol';
import { type Accessor, untrack } from 'solid-js';
import { createVisibleRefresh } from './visible-refresh';

/**
 * Refreshes after cache changes on `createVisibleRefresh`'s terms. This does
 * not pause cache ingestion, mutations, or explicit/initial requests.
 *
 * The caller must unsubscribe on disposal.
 */
export function subscribeToVisibleCacheChanges(
  host: Pick<CacheHost, 'onCacheChanged'> &
    Partial<Pick<CacheHost, 'onCacheGenerationChanged'>>,
  refresh: (revision: CacheRevision) => void | Promise<unknown>,
  options?: {
    /** Engine proof for the exact displayed window; absent means refresh. */
    observation?: Accessor<string | undefined>;
    searchBuckets?: Accessor<readonly string[] | undefined>;
    /** Observe accepted changes immediately for in-flight revision fencing. */
    onChange?: CacheChangeListener;
  }
): () => void {
  let latestRevision: CacheRevision | undefined;
  const visibleRefresh = createVisibleRefresh(() =>
    latestRevision === undefined ? undefined : refresh(latestRevision)
  );
  let disposed = false;
  const unsubscribe = host.onCacheChanged(
    (revision, changes) => {
      if (disposed) return;
      const observation = options?.observation && untrack(options.observation);
      if (observation && changes?.unchangedViews?.includes(observation)) return;
      const changedBuckets = changes?.searchChangedBuckets;
      if (options?.searchBuckets && changedBuckets !== undefined) {
        const watched = untrack(options.searchBuckets);
        if (
          watched &&
          !changedBuckets.some((bucket) => watched.includes(bucket))
        )
          return;
      }
      latestRevision = revision;
      options?.onChange?.(revision, changes);
      visibleRefresh.markDirty();
    },
    { includeHydration: true }
  );
  const unsubscribeGeneration = host.onCacheGenerationChanged?.(() => {
    // A revision belongs to one engine generation. Never publish a queued
    // watermark after its engine has retired; the caller refreshes the new one.
    latestRevision = undefined;
    visibleRefresh.reset();
  });

  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeGeneration?.();
    visibleRefresh.dispose();
  };
}
