import type { CacheRequest } from '../protocol';

/** Only RPCs that cannot durably change storage may time out or bypass a handoff. */
export function isReadOnlyCacheRequest(kind: CacheRequest['kind']): boolean {
  return (
    kind === 'current-revision' ||
    kind === 'current-storage-generation' ||
    kind === 'read' ||
    kind === 'read-records-by-keys' ||
    kind === 'search' ||
    kind === 'people-references' ||
    kind === 'people-sql' ||
    kind === 'contact-snapshot' ||
    kind === 'entity-filter' ||
    kind === 'calendar-range' ||
    kind === 'channel-timeline' ||
    kind === 'channel-timeline-stats' ||
    kind === 'people-context' ||
    kind === 'people-search' ||
    kind === 'inspect-mutations' ||
    kind === 'inspect-query' ||
    kind === 'inspect-query-variants'
  );
}

/** Requests that neither return nor store cached content. */
function isControlCacheRequest(kind: CacheRequest['kind']): boolean {
  return (
    kind === 'init' ||
    kind === 'current-authority' ||
    kind === 'transition-authority' ||
    kind === 'claim-next-mutation' ||
    kind === 'defer-optimistic-write' ||
    kind === 'rollback-optimistic-write' ||
    kind === 'teardown' ||
    kind === 'clear'
  );
}

/**
 * Whose generation a request carries. Reads and removals hold no fetched
 * content, so a host stamps them with the generation it observes, and control
 * requests carry none. Every other request, including any kind added later,
 * stores content and must carry the generation that content was captured under.
 */
export function cacheRequestStamp(
  kind: CacheRequest['kind']
): 'observed' | 'captured' | 'none' {
  if (
    isReadOnlyCacheRequest(kind) ||
    kind === 'invalidate' ||
    kind === 'delete-records' ||
    kind === 'channel-timeline-evict'
  )
    return 'observed';
  if (isControlCacheRequest(kind)) return 'none';
  return 'captured';
}

/** Interrupts read-only startup waits without canceling initialization or writes. */
export class CacheReadAvailability {
  private unavailable: Error | undefined;
  private paused = false;
  private readonly waiting = new Set<(error: Error) => void>();

  get error(): Error | undefined {
    return this.unavailable;
  }

  get timeoutsPaused(): boolean {
    return this.paused;
  }

  wait(): void {
    this.paused = true;
    this.unavailable = undefined;
  }

  block(error: Error): void {
    this.paused = true;
    this.unavailable = error;
    for (const reject of this.waiting) reject(error);
    this.waiting.clear();
  }

  resume(): void {
    this.paused = false;
    this.unavailable = undefined;
  }

  async waitUntilReady(
    initialize: () => Promise<void>,
    readOnly: boolean
  ): Promise<void> {
    if (readOnly && this.unavailable) throw this.unavailable;
    let rejectRead: ((error: Error) => void) | undefined;
    const blocked = new Promise<never>((_resolve, reject) => {
      rejectRead = reject;
      if (readOnly) this.waiting.add(reject);
    });
    try {
      // Both read and write startup waits take the same microtask path so
      // making reads interruptible cannot reorder admission ahead of writes.
      await Promise.race([initialize(), blocked]);
      if (readOnly && this.unavailable) throw this.unavailable;
    } finally {
      if (rejectRead) this.waiting.delete(rejectRead);
    }
  }
}
