import type { CachePush } from '../protocol';

type CacheChangePush = Extract<
  CachePush,
  { kind: 'cache-changed' | 'cache-hydrated' }
>;

export type CoalescedCacheChange = { push: CacheChangePush; count: number };

// A continuously busy coordinator must still let subscribers catch up. Bound
// completed requests instead of relying on idle time or a transaction timer.
const MAX_REQUESTS_PER_BATCH = 64;

/** Coalesces broad refresh hints, never write replies or dependency/settlement pushes. */
export class CacheChangeBatch {
  private readonly pending = new Map<
    CacheChangePush['kind'],
    CoalescedCacheChange
  >();
  private requests = 0;

  add(push: CacheChangePush): void {
    if (push.kind === 'cache-changed' && push.reset) {
      // A generation fence supersedes every earlier refresh hint.
      this.pending.clear();
      this.requests = 0;
    }
    const previous = this.pending.get(push.kind);
    if (previous) {
      const buckets =
        previous.push.searchChangedBuckets !== undefined &&
        push.searchChangedBuckets !== undefined
          ? [
              ...new Set([
                ...previous.push.searchChangedBuckets,
                ...push.searchChangedBuckets,
              ]),
            ]
          : undefined;
      // Missing scope means all buckets, and dominates any narrower hint.
      push = {
        kind: push.kind,
        revision: push.revision,
        ...(buckets === undefined ? {} : { searchChangedBuckets: buckets }),
      };
    }
    // Emit the channels in revision order without promoting hydration to an
    // authoritative foreground invalidation.
    this.pending.delete(push.kind);
    this.pending.set(push.kind, { push, count: (previous?.count ?? 0) + 1 });
  }

  requestCompleted(queueEmpty: boolean): CoalescedCacheChange[] {
    if (this.pending.size === 0) return [];
    this.requests += 1;
    return queueEmpty || this.requests >= MAX_REQUESTS_PER_BATCH
      ? this.flush()
      : [];
  }

  flush(): CoalescedCacheChange[] {
    const changes = [...this.pending.values()];
    this.pending.clear();
    this.requests = 0;
    return changes;
  }
}
