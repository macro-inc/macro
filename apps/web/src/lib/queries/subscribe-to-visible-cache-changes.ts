import { fireAndForget } from '@core/util/fireAndForget';
import type { CacheChangeListener, CacheHost } from '@graphql-cache/host/types';
import type { CacheRevision } from '@graphql-cache/protocol';
import { makeEventListener } from '@solid-primitives/event-listener';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';
import { type Accessor, untrack } from 'solid-js';

const CACHE_REFRESH_INTERVAL_MS = 250;

/**
 * Throttles cache-driven UI refreshes while visible. Hidden tabs retain one
 * dirty bit instead of repeatedly reading the shared cache; becoming visible
 * refreshes once against its latest state. Async refreshes finish before one
 * dirty follow-up runs, so a busy cache cannot continually cancel its readers.
 * This does not pause cache ingestion, mutations, or explicit/initial requests.
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
  let dirty = false;
  let latestRevision: CacheRevision | undefined;
  let disposed = false;
  let refreshing = false;
  const isVisible = () => document.visibilityState === 'visible';
  const runRefresh = async () => {
    // Visibility can change between scheduling and the trailing callback.
    if (
      disposed ||
      refreshing ||
      !dirty ||
      latestRevision === undefined ||
      !isVisible()
    )
      return;
    dirty = false;
    refreshing = true;
    try {
      const completion = refresh(latestRevision);
      if (completion) await completion;
    } catch (error) {
      console.warn('Cache-driven refresh failed', error);
    } finally {
      refreshing = false;
      // Keep changes received during a read, including the last change in a
      // burst. A failed read only retries if another change made it dirty.
      if (dirty && !disposed && isVisible()) scheduled();
    }
  };
  const scheduled = leadingAndTrailing(
    throttle,
    () => fireAndForget(runRefresh(), 'visible-cache-refresh'),
    CACHE_REFRESH_INTERVAL_MS
  );
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
      dirty = true;
      if (isVisible()) scheduled();
    },
    { includeHydration: true }
  );
  const unsubscribeGeneration = host.onCacheGenerationChanged?.(() => {
    // A revision belongs to one engine generation. Never publish a queued
    // watermark after its engine has retired; the caller refreshes the new one.
    dirty = false;
    latestRevision = undefined;
    scheduled.clear();
  });
  const removeVisibilityListener = makeEventListener(
    document,
    'visibilitychange',
    () => {
      // Cancel pending background work without losing its dirty state. Reset
      // the throttle so a visible tab catches up immediately, not on a timer.
      scheduled.clear();
      if (dirty && !disposed && isVisible()) scheduled();
    }
  );

  return () => {
    disposed = true;
    unsubscribe();
    unsubscribeGeneration?.();
    removeVisibilityListener();
    scheduled.clear();
  };
}
