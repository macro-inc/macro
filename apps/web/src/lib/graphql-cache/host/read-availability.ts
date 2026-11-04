import type { CacheRequest } from '../protocol';

/** Only RPCs that cannot durably change storage may time out or bypass a handoff. */
export function isReadOnlyCacheRequest(kind: CacheRequest['kind']): boolean {
  return (
    kind === 'current-revision' ||
    kind === 'current-storage-generation' ||
    kind === 'read' ||
    kind === 'read-records-by-keys' ||
    kind === 'search' ||
    kind === 'entity-filter' ||
    kind === 'calendar-range' ||
    kind === 'inspect-mutations' ||
    kind === 'inspect-query' ||
    kind === 'inspect-query-variants'
  );
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
