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

type Indexed = {
  request: CacheRequest;
  /** `operationsOf(request)`. */
  ops: readonly string[];
  /** Its place in arrival order: a request queued later has a larger one. */
  seq: number;
};

/**
 * The queued requests about each operation, in queue order, kept as
 * requests join and leave the queue. A pick asks it what a request waits
 * for in a few map reads, instead of walking the queue ahead of it.
 */
export class OperationIndex<T extends Indexed> {
  private readonly touches = new Map<string, T[]>();
  private readonly teardowns = new Map<string, T[]>();
  private queuedTeardowns = 0;

  /** Whether any queued request is a teardown: without one, nothing waits. */
  get hasTeardowns(): boolean {
    return this.queuedTeardowns > 0;
  }

  add(queued: T): void {
    const teardown = queued.request.kind === 'teardown';
    for (const op of queued.ops) {
      append(this.touches, op, queued);
      if (teardown) append(this.teardowns, op, queued);
    }
    if (teardown) this.queuedTeardowns += 1;
  }

  remove(queued: T): void {
    const teardown = queued.request.kind === 'teardown';
    for (const op of queued.ops) {
      drop(this.touches, op, queued);
      if (teardown) drop(this.teardowns, op, queued);
    }
    if (teardown) this.queuedTeardowns -= 1;
  }

  /**
   * The request queued ahead of `queued` that it waits for, if any. A
   * teardown waits for the first request about its operation; any other
   * request waits for the first teardown of one of its operations.
   */
  blockerOf(queued: T): T | undefined {
    const ahead =
      queued.request.kind === 'teardown' ? this.touches : this.teardowns;
    let blocker: T | undefined;
    for (const op of queued.ops) {
      const first = ahead.get(op)?.[0];
      if (
        first !== undefined &&
        first.seq < queued.seq &&
        (blocker === undefined || first.seq < blocker.seq)
      )
        blocker = first;
    }
    return blocker;
  }

  /** The last queued teardown of `opId`, if any. */
  lastTeardownOf(opId: string): T | undefined {
    const list = this.teardowns.get(opId);
    return list?.[list.length - 1];
  }

  /** What has to run before `queued` can: its blockers, followed to one that waits for nothing. */
  rootOf(queued: T): T {
    let root = queued;
    for (
      let blocker = this.blockerOf(root);
      blocker !== undefined;
      blocker = this.blockerOf(root)
    )
      root = blocker;
    return root;
  }
}

function append<T>(lists: Map<string, T[]>, op: string, queued: T): void {
  const list = lists.get(op);
  if (list) list.push(queued);
  else lists.set(op, [queued]);
}

function drop<T>(lists: Map<string, T[]>, op: string, queued: T): void {
  const list = lists.get(op);
  if (!list) return;
  const at = list.indexOf(queued);
  if (at !== -1) list.splice(at, 1);
  if (list.length === 0) lists.delete(op);
}
