import type { CacheRequest } from '../protocol';
import { visibleTimeout } from './visible-timeout';

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
    kind === 'delete-records'
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
  private readonly waitingWrites = new Set<(error: Error) => void>();

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

  /** Like `block`, for writes that wait for a handshake too. */
  blockAll(error: Error): void {
    this.block(error);
    for (const reject of this.waitingWrites) reject(error);
    this.waitingWrites.clear();
  }

  resume(): void {
    this.paused = false;
    this.unavailable = undefined;
  }

  /** `expiresAfter` bounds a read's wait; a write has none. An aborted read
   * leaves nothing behind. A `held` write is not given up by `blockAll`. */
  async waitUntilReady(
    initialize: () => Promise<void>,
    admission: 'read' | 'write' | 'held',
    expiresAfter?: {
      timeoutMs: number;
      error: () => Error;
      signal?: AbortSignal;
    }
  ): Promise<void> {
    const readOnly = admission === 'read';
    if (readOnly && this.unavailable) throw this.unavailable;
    let rejectWait: ((error: Error) => void) | undefined;
    const blocked = new Promise<never>((_resolve, reject) => {
      rejectWait = reject;
      if (readOnly) this.waiting.add(reject);
      if (admission === 'write') this.waitingWrites.add(reject);
    });
    const bound = readOnly ? expiresAfter : undefined;
    const end = () => {
      if (bound) rejectWait?.(bound.error());
    };
    const stopTimeout = bound && visibleTimeout(end, bound.timeoutMs);
    bound?.signal?.addEventListener('abort', end, { once: true });
    try {
      // Both read and write startup waits take the same microtask path so
      // making reads interruptible cannot reorder admission ahead of writes.
      await Promise.race([initialize(), blocked]);
      if (readOnly && this.unavailable) throw this.unavailable;
    } finally {
      stopTimeout?.();
      bound?.signal?.removeEventListener('abort', end);
      if (rejectWait) {
        this.waiting.delete(rejectWait);
        this.waitingWrites.delete(rejectWait);
      }
    }
  }
}
