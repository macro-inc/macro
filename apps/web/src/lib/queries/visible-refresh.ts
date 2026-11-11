import { fireAndForget } from '@core/util/fireAndForget';
import { makeEventListener } from '@solid-primitives/event-listener';
import { leadingAndTrailing, throttle } from '@solid-primitives/scheduled';

const REFRESH_INTERVAL_MS = 250;
/** For refreshes that rebuild account-wide state, such as the channel index. */
export const ACCOUNT_WIDE_REFRESH_INTERVAL_MS = 2_000;

/**
 * Throttles refreshes while visible: the first change refreshes at once and
 * the rest of a burst share one refresh per `intervalMs`. Hidden tabs retain one dirty bit instead
 * of repeatedly reading; becoming visible refreshes once against the latest
 * state. Async refreshes finish before one dirty follow-up runs, so a busy
 * source cannot continually cancel its readers. With `refreshOnShow`, becoming
 * visible refreshes even if nothing marked it dirty, for a source whose change
 * signal can be lost.
 *
 * The caller must dispose it.
 */
export function createVisibleRefresh(
  refresh: () => void | Promise<unknown>,
  {
    refreshOnShow = false,
    intervalMs = REFRESH_INTERVAL_MS,
  }: { refreshOnShow?: boolean; intervalMs?: number } = {}
): {
  markDirty: () => void;
  dispose: () => void;
} {
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
      console.warn('Visible refresh failed', error);
    } finally {
      refreshing = false;
      // Keep changes received during a read, including the last change in a
      // burst. A failed read only retries if another change made it dirty.
      if (dirty && !disposed && isVisible()) scheduled();
    }
  };
  const scheduled = leadingAndTrailing(
    throttle,
    () => fireAndForget(runRefresh(), 'visible-refresh'),
    intervalMs
  );
  const removeVisibilityListener = makeEventListener(
    document,
    'visibilitychange',
    () => {
      // Cancel pending background work without losing its dirty state. Reset
      // the throttle so a visible tab catches up immediately, not on a timer.
      scheduled.clear();
      if (disposed || !isVisible()) return;
      if (refreshOnShow) dirty = true;
      if (dirty) scheduled();
    }
  );

  return {
    markDirty: () => {
      if (disposed) return;
      dirty = true;
      if (isVisible()) scheduled();
    },
    dispose: () => {
      disposed = true;
      removeVisibilityListener();
      scheduled.clear();
    },
  };
}

/**
 * Runs immediately while visible, with no throttle. A hidden tab keeps one dirty
 * bit and runs once when it becomes visible, for a source whose own reads
 * already coalesce.
 *
 * The caller must dispose it.
 */
export function createHiddenDeferral(run: () => void): {
  request: () => void;
  dispose: () => void;
} {
  let deferred = false;
  const dispose = makeEventListener(document, 'visibilitychange', () => {
    if (!deferred || document.visibilityState === 'hidden') return;
    deferred = false;
    run();
  });
  return {
    request: () => {
      deferred = document.visibilityState === 'hidden';
      if (!deferred) run();
    },
    dispose,
  };
}
