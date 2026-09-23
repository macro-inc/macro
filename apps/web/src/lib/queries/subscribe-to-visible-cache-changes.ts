import type { CacheHost } from '@graphql-cache/host/types';
import { makeEventListener } from '@solid-primitives/event-listener';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';

const CACHE_REFRESH_INTERVAL_MS = 250;

/**
 * Throttles cache-driven UI refreshes while visible. Hidden tabs retain one
 * dirty bit instead of repeatedly reading the shared cache; becoming visible
 * refreshes once against its latest state. This does not pause cache ingestion,
 * mutations, or explicit/initial query requests.
 *
 * The caller must unsubscribe on disposal.
 */
export function subscribeToVisibleCacheChanges(
  host: Pick<CacheHost, 'onCacheChanged'>,
  refresh: () => void
): () => void {
  let dirty = false;
  let disposed = false;
  const isVisible = () => document.visibilityState === 'visible';
  const scheduled = leadingAndTrailing(
    throttle,
    () => {
      // Visibility can change between scheduling and the trailing callback.
      if (disposed || !dirty || !isVisible()) return;
      dirty = false;
      refresh();
    },
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
