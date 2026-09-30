type Slice = (run: () => void) => () => void;

/** An idle callback where the browser has one; a macrotask where it does not (Safari). */
const nextSlice: Slice = (run) => {
  if (typeof window !== 'undefined' && 'requestIdleCallback' in window) {
    const id = window.requestIdleCallback(run, { timeout: 100 });
    return () => window.cancelIdleCallback(id);
  }
  const id = setTimeout(run, 0);
  return () => clearTimeout(id);
};

export type MountQueue = {
  /** Queue `mount`; returns a cancel for when the item goes away first. */
  enqueue: (mount: () => void) => () => void;
  dispose: () => void;
};

/**
 * Runs queued mounts one per task, in order, so a burst of heavy mounts (a
 * page of thread cards) never holds the main thread for the whole burst.
 */
export function createMountQueue(slice: Slice = nextSlice): MountQueue {
  const pending: (() => void)[] = [];
  let cancelSlice: (() => void) | undefined;

  const schedule = () => {
    if (cancelSlice || pending.length === 0) return;
    cancelSlice = slice(() => {
      cancelSlice = undefined;
      pending.shift()?.();
      schedule();
    });
  };

  return {
    enqueue: (mount) => {
      pending.push(mount);
      schedule();
      return () => {
        const index = pending.indexOf(mount);
        if (index >= 0) pending.splice(index, 1);
      };
    },
    dispose: () => {
      pending.length = 0;
      cancelSlice?.();
      cancelSlice = undefined;
    },
  };
}
