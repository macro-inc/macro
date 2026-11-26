import type { CacheRequest } from '../protocol';

/**
 * How an operation's teardown orders the queue.
 *
 * Tearing down operation X removes X's registration in the engine: the
 * records it depends on and its retained watch view. Nothing else reads or
 * changes that state, so a teardown only has to keep three things true, and
 * all three are about X:
 *
 * 1. A request about X queued before the teardown runs before it. A read of
 *    X run after it would register X again, for a view that is gone.
 * 2. A request about X queued after the teardown runs after it. A remount's
 *    read run before it would have its registration removed, and the view
 *    would stop hearing about changes.
 * 3. A read of X queued after the teardown never shares an answer with one
 *    queued before it, so a remount always registers afresh.
 *
 * Every other request may pass the teardown either way: whether a write runs
 * before or after it changes only whether that write names X among the
 * operations it affected, and a page ignores news of a view it unmounted.
 */

/** The operations a request registers, reads for, or tears down. */
export function operationsOf(request: CacheRequest): readonly string[] {
  switch (request.kind) {
    case 'teardown':
      return [request.opId];
    case 'read':
      return request.opId === undefined ? [] : [request.opId];
    case 'write': {
      const ops: string[] = [];
      if (request.registration) ops.push(request.registration.opId);
      if (request.originOpId !== undefined) ops.push(request.originOpId);
      return ops;
    }
    case 'enqueue-optimistic-mutation':
      return request.originOpId === undefined ? [] : [request.originOpId];
    default:
      return [];
  }
}

/**
 * For each of the first `end` queued requests, the index of the request that
 * has to run before it can: itself when nothing ahead of it is ordered against
 * it, else (through as many such requests as there are) the earliest request
 * ahead of it that is. A request that waits lends its priority to the one it
 * waits for, so a remount's user-visible read does not wait behind every
 * request queued before the old view's teardown.
 */
export function runnableIndexes(
  queue: readonly { request: CacheRequest }[],
  end: number
): number[] {
  const firstTouch = new Map<string, number>();
  const firstTeardown = new Map<string, number>();
  const runnable: number[] = [];
  for (let i = 0; i < end; i += 1) {
    const request = queue[i]?.request;
    const ops = request ? operationsOf(request) : [];
    const teardown = request?.kind === 'teardown';
    let blocker: number | undefined;
    for (const op of ops) {
      const ahead = teardown ? firstTouch.get(op) : firstTeardown.get(op);
      if (ahead !== undefined && (blocker === undefined || ahead < blocker)) {
        blocker = ahead;
      }
    }
    runnable.push(blocker === undefined ? i : (runnable[blocker] ?? blocker));
    for (const op of ops) {
      if (!firstTouch.has(op)) firstTouch.set(op, i);
      if (teardown && !firstTeardown.has(op)) firstTeardown.set(op, i);
    }
  }
  return runnable;
}

/** Index of the last teardown of `opId` among `queue`, or -1. */
export function lastTeardownOf(
  queue: readonly { request: CacheRequest }[],
  opId: string
): number {
  for (let i = queue.length - 1; i >= 0; i -= 1) {
    const request = queue[i]?.request;
    if (request?.kind === 'teardown' && request.opId === opId) return i;
  }
  return -1;
}
