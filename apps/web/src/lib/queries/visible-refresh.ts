import { fireAndForget } from '@core/util/fireAndForget';
import { makeEventListener } from '@solid-primitives/event-listener';
import { type Accessor, untrack } from 'solid-js';

const REFRESH_INTERVAL_MS = 250;
/** For refreshes that rebuild account-wide state, such as the channel index. */
export const ACCOUNT_WIDE_REFRESH_INTERVAL_MS = 2_000;
const IDLE_REFRESH_INTERVAL_MS = 60_000;

/**
 * An `intervalMs` for a source only some views read: `readingMs` while
 * `reading` is true, and at most once a minute otherwise, so the source stays
 * roughly current without a read as a view opens.
 */
export function intervalWhileRead(
  reading: Accessor<boolean>,
  readingMs = REFRESH_INTERVAL_MS
): Accessor<number> {
  return () => (reading() ? readingMs : IDLE_REFRESH_INTERVAL_MS);
}

/**
 * Throttles refreshes while visible: a change after a quiet `intervalMs`
 * refreshes at once, and refreshes never start closer together than that. A
 * function `intervalMs` is read whenever a refresh is scheduled and again when
 * a pending one is due: a later schedule moves it earlier if the interval has
 * shrunk, and it waits out the rest if the interval has grown. Hidden tabs
 * retain one dirty bit instead of repeatedly reading; becoming visible
 * refreshes once against the latest state. Async refreshes finish before one dirty follow-up runs, so a busy
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
  }: { refreshOnShow?: boolean; intervalMs?: number | Accessor<number> } = {}
): {
  markDirty: () => void;
  dispose: () => void;
} {
  let dirty = false;
  let disposed = false;
  let refreshing = false;
  let lastStartedAt = Number.NEGATIVE_INFINITY;
  const isVisible = () => document.visibilityState === 'visible';
  const runRefresh = async () => {
    // Visibility can change between scheduling and the trailing callback.
    if (disposed || refreshing || !dirty || !isVisible()) return;
    dirty = false;
    refreshing = true;
    lastStartedAt = performance.now();
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
  const start = () => fireAndForget(runRefresh(), 'visible-refresh');
  let timer: ReturnType<typeof setTimeout> | undefined;
  let dueAt = Number.POSITIVE_INFINITY;
  const cancelLater = () => {
    clearTimeout(timer);
    timer = undefined;
    dueAt = Number.POSITIVE_INFINITY;
  };
  const currentInterval = () =>
    typeof intervalMs === 'number' ? intervalMs : untrack(intervalMs);
  const startLater = (waitMs: number) => {
    const at = performance.now() + waitMs;
    if (timer !== undefined && dueAt <= at) return;
    cancelLater();
    dueAt = at;
    timer = setTimeout(() => {
      timer = undefined;
      dueAt = Number.POSITIVE_INFINITY;
      const remainingMs = lastStartedAt + currentInterval() - performance.now();
      if (remainingMs > 0) startLater(remainingMs);
      else start();
    }, waitMs);
  };
  const scheduled = () => {
    const waitMs = currentInterval();
    if (performance.now() - lastStartedAt < waitMs) {
      startLater(waitMs);
      return;
    }

    cancelLater();
    start();
  };
  const removeVisibilityListener = makeEventListener(
    document,
    'visibilitychange',
    () => {
      // Cancel pending background work without losing its dirty state. Reset
      // the spacing so a visible tab catches up immediately, not on a timer.
      cancelLater();
      lastStartedAt = Number.NEGATIVE_INFINITY;
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
      cancelLater();
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
