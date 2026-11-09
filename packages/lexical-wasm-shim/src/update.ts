import type { CommitPacket, ShimBackend } from './backend';

export interface UpdateOptions {
  readonly tag?: string | readonly string[];
  readonly discrete?: boolean;
  readonly onUpdate?: () => void;
}
interface QueuedUpdate {
  readonly body: () => void;
  readonly options: UpdateOptions;
}
interface Host {
  readonly backend: ShimBackend;
  readonly scope: <T>(body: () => T) => T;
  readonly apply: (packet: CommitPacket) => void;
  readonly notificationScope: (body: () => void) => void;
  readonly onError: (error: unknown) => void;
}

/** JS batching boundary; every mutation and transform still runs in the Rust model. */
export class UpdateController {
  private readonly listeners = new Set<(packet: CommitPacket) => void>();
  private readonly queued: QueuedUpdate[] = [];
  private readonly deferred: (() => void)[] = [];
  private pending = false;
  private running = false;
  private scheduled = false;
  private sync = false;
  private disposed = false;
  private released = false;
  private epoch = 0;
  private cascade = 0;

  constructor(private readonly host: Host) {}

  addUpdateListener(listener: (packet: CommitPacket) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  update(body: () => void, options: UpdateOptions = {}): void {
    if (this.disposed) throw new Error('editor is disposed');
    if (this.running) {
      this.queued.push({ body, options });
      return;
    }
    this.performUpdate(body, options, false);
  }

  /** Non-update listeners enqueue ordinary updates without granting a scope. */
  notify(body: () => void): void {
    const previous = this.running;
    this.running = true;
    try {
      this.host.notificationScope(body);
    } finally {
      this.running = previous;
      if (this.disposed && !previous) this.release();
    }
  }

  /** Internal command updates bypass the ordinary enqueued-update boundary. */
  updateSync(body: () => void, options: UpdateOptions = {}): void {
    if (this.disposed) throw new Error('editor is disposed');
    this.performUpdate(body, options, this.running);
  }

  private performUpdate(
    body: () => void,
    options: UpdateOptions,
    restoreRunning: boolean
  ): void {
    this.running = true;
    const opened = !this.pending;
    let failed = false;
    try {
      this.host.scope(() => {
        const tags = this.tags(options);
        if (!this.pending) {
          this.host.backend.beginUpdate(tags, options.discrete === true);
          this.pending = true;
        } else {
          for (const tag of tags)
            this.host.backend.call('lexical.$addUpdateTag', [tag]);
        }
        const startingComposition = this.composition();
        this.run(body, options, false);
        this.drain();
        if (this.disposed) return;
        this.host.backend.flush();
        while (this.queued.length > 0 && !this.disposed) {
          this.drain();
          if (this.disposed) return;
          this.host.backend.flush();
        }
        this.sync ||= startingComposition !== this.composition();
        if (
          opened &&
          this.deferred.length === 0 &&
          this.host.backend.finishNoop()
        ) {
          this.pending = false;
          this.sync = false;
          this.cascade = 0;
        }
      });
    } catch (error) {
      this.abort();
      failed = true;
      this.host.onError(error);
    } finally {
      this.running = restoreRunning;
      if (this.disposed && !restoreRunning) this.release();
    }
    if (this.disposed) return;
    if (failed) {
      if (!restoreRunning) this.triggerQueued();
      return;
    }
    if (this.sync && !restoreRunning) this.publish();
    else if (this.pending) this.schedule();
    else if (!restoreRunning) this.triggerQueued();
  }

  /** Force pending work through publication, without publishing mid-callback. */
  flush(): void {
    if (this.disposed) return;
    if (this.running && this.pending) this.sync = true;
    else this.publish();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.epoch++;
    if (!this.running) this.release();
  }

  private tags(options: UpdateOptions): readonly string[] {
    const tag = options.tag;
    if (tag === undefined) return [];
    return typeof tag === 'string' ? [tag] : tag;
  }

  private composition(): string | null {
    const key = this.host.backend.call('lexical.$getCompositionKey', []);
    if (key === null || typeof key === 'string') return key;
    if (typeof key === 'object' && 'raw' in key && typeof key.raw === 'string')
      return key.raw;
    throw new Error('invalid composition key encoding');
  }

  private run(
    body: () => void,
    options: UpdateOptions,
    addTags: boolean
  ): void {
    if (addTags) {
      for (const tag of this.tags(options))
        this.host.backend.call('lexical.$addUpdateTag', [tag]);
    }
    this.sync ||= options.discrete === true;
    if (options.onUpdate !== undefined) this.deferred.push(options.onUpdate);
    body();
  }

  private drain(): void {
    while (this.queued.length > 0 && !this.disposed) {
      const update = this.queued.shift();
      if (update !== undefined) this.run(update.body, update.options, true);
    }
  }

  private schedule(): void {
    if (this.scheduled || !this.pending) return;
    this.scheduled = true;
    const epoch = this.epoch;
    queueMicrotask(() => {
      if (this.disposed || this.epoch !== epoch) return;
      this.scheduled = false;
      this.publish();
    });
  }

  private publish(): void {
    if (!this.pending || this.disposed) return;
    this.epoch++;
    this.scheduled = false;
    this.sync = false;
    this.running = true;
    let packet: CommitPacket;
    try {
      packet = this.host.scope(() => this.host.backend.commit());
      this.pending = false;
      this.sync = false;
    } catch (error) {
      // Model commit discards its failed transaction before returning the error.
      this.pending = false;
      this.clear();
      try {
        this.host.onError(error);
      } finally {
        this.running = false;
        if (this.disposed) this.release();
      }
      this.triggerQueued();
      return;
    }
    const deferred = this.deferred.splice(0);
    try {
      this.host.apply(packet);
      this.host.notificationScope(() => {
        if (packet.changed || deferred.length > 0) {
          for (const listener of [...this.listeners]) {
            if (this.disposed) break;
            listener(packet);
          }
        }
        for (const callback of deferred) {
          if (this.disposed) break;
          callback();
        }
      });
    } catch (error) {
      this.host.onError(error);
    } finally {
      this.running = false;
      if (this.disposed) this.release();
    }
    this.triggerQueued();
  }

  private triggerQueued(): void {
    if (this.disposed) return;
    if (this.queued.length === 0) {
      this.cascade = 0;
      return;
    }
    if (this.cascade++ > 99) {
      this.queued.length = 0;
      this.cascade = 0;
      this.host.onError(
        new Error(
          'One or more update listeners are endlessly enqueueing more updates. May have encountered infinite recursion caused by update listeners that trigger additional updates without a stop condition.'
        )
      );
      return;
    }
    const next = this.queued.shift();
    if (next !== undefined) this.update(next.body, next.options);
  }

  private clear(): void {
    this.epoch++;
    this.scheduled = false;
    this.sync = false;
    this.queued.length = 0;
    this.deferred.length = 0;
    this.cascade = 0;
  }

  private abort(): void {
    if (this.pending) {
      this.host.backend.discard();
      this.pending = false;
    }
    this.clear();
  }

  private release(): void {
    if (this.released) return;
    this.abort();
    this.listeners.clear();
    this.host.backend.dispose();
    this.released = true;
  }
}
