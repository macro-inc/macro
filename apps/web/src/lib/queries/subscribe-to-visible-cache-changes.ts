import type { CacheHost } from '@graphql-cache/host/types';
import { makeEventListener } from '@solid-primitives/event-listener';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';

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
  host: Pick<CacheHost, 'onCacheChanged'>,
  refresh: () => void | Promise<unknown>
): () => void {
  let dirty = false;
  let disposed = false;
  let refreshing = false;
  const isVisible = () => document.visibilityState === 'visible';
  const runRefresh = async () => {
    // Visibility can change between scheduling and the trailing callback.
    if (disposed || refreshing || !dirty || !isVisible()) return;
    dirty = false;
    refreshing = true;
    try {
      const completion = refresh();
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
    () => void runRefresh(),
    CACHE_REFRESH_INTERVAL_MS
  );
  const unsubscribe = host.onCacheChanged(
    () => {
      if (disposed) return;
      dirty = true;
      if (isVisible()) scheduled();
    },
    { includeHydration: true }
  );
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
    removeVisibilityListener();
    scheduled.clear();
  };
}
