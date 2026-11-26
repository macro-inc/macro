import { match, P } from 'ts-pattern';
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
 * Every other request may pass the teardown either way. Whether a write runs
 * before or after it changes whether that write names X among the operations
 * it affected: a page ignores news of a view it unmounted, and a remount that
 * hears of a write its own read already saw only reads again. A watch read
 * that passes a teardown can also evict another view at the watch limit,
 * which only makes that view's next update a full read.
 */

/**
 * The operations a request registers, reads for, or tears down. Every kind
 * is listed, so a new one has to say whether a teardown orders it.
 */
export function operationsOf(request: CacheRequest): readonly string[] {
  return (
    match(request)
      .with({ kind: 'teardown' }, ({ opId }) => [opId])
      .with({ kind: 'read' }, ({ opId }) => (opId === undefined ? [] : [opId]))
      .with({ kind: 'write' }, ({ registration, originOpId }) => [
        ...(registration ? [registration.opId] : []),
        ...(originOpId === undefined ? [] : [originOpId]),
      ])
      .with({ kind: 'enqueue-optimistic-mutation' }, ({ originOpId }) =>
        originOpId === undefined ? [] : [originOpId]
      )
      .with(
        {
          kind: P.union(
            'init',
            'current-revision',
            'current-storage-generation',
            'current-authority',
            'transition-authority',
            'inspect-mutations',
            'hydrate',
            'claim-next-mutation',
            'defer-optimistic-write',
            'commit-optimistic-write',
            'rollback-optimistic-write',
            'read-records-by-keys',
            'search',
            'entity-filter',
            'calendar-range',
            'calendar-commit',
            'inspect-query',
            'inspect-query-variants',
            'invalidate',
            'delete-records',
            'clear',
            'people-context',
            'people-update',
            'people-search',
            'people-references',
            'people-sql',
            'contact-snapshot',
            'contact-reconcile'
          ),
        },
        () => []
      )
      // A kind from a newer page orders nothing here; running it rejects it.
      .exhaustive(() => [])
  );
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
  queue: readonly { request: CacheRequest; ops: readonly string[] }[],
  end: number
): number[] {
  // Only operations with a teardown queued order anything.
  const tornDown = new Set<string>();
  for (let i = 0; i < end; i += 1) {
    const request = queue[i]?.request;
    if (request?.kind === 'teardown') tornDown.add(request.opId);
  }
  const firstTouch = new Map<string, number>();
  const firstTeardown = new Map<string, number>();
  const runnable: number[] = [];
  for (let i = 0; i < end; i += 1) {
    const queued = queue[i];
    const teardown = queued?.request.kind === 'teardown';
    let blocker: number | undefined;
    for (const op of queued?.ops ?? []) {
      if (!tornDown.has(op)) continue;
      const ahead = teardown ? firstTouch.get(op) : firstTeardown.get(op);
      if (ahead !== undefined && (blocker === undefined || ahead < blocker)) {
        blocker = ahead;
      }
      if (!firstTouch.has(op)) firstTouch.set(op, i);
      if (teardown && !firstTeardown.has(op)) firstTeardown.set(op, i);
    }
    runnable.push(blocker === undefined ? i : (runnable[blocker] ?? blocker));
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
