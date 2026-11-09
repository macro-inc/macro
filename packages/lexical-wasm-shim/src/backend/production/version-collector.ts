export interface VersionCollectorRuntime {
  /** Actual issued/active/pending/read/publication/version-lease guards, JS only. */
  canCollect(version: bigint): boolean;
  /** Return only after actual pending capture leases have been acknowledged. */
  flushLeases(): void;
  /** Successful return acknowledges the actual native version retirement. */
  releaseVersion(version: bigint): void;
  scheduleDrain(body: () => void): void;
}

type FlushPhase = 'before-release' | 'after-release';
export type VersionCollectorEvent =
  | {
      readonly sequence: number;
      readonly version: bigint;
      readonly kind: 'queued' | 'cancelled' | 'release-start' | 'release-ack';
    }
  | {
      readonly sequence: number;
      readonly version: bigint;
      readonly kind: 'blocked' | 'lease-flush-start' | 'lease-flush-ack';
      readonly phase: FlushPhase;
    }
  | {
      readonly sequence: number;
      readonly version: bigint;
      readonly kind: 'failure';
      readonly phase: FlushPhase | 'release';
    }
  | { readonly sequence: number; readonly kind: 'disposed' };

type EventInput = VersionCollectorEvent extends infer Event
  ? Event extends VersionCollectorEvent
    ? Omit<Event, 'sequence'>
    : never
  : never;
interface Collection {
  readonly unowned: () => boolean;
  readonly released: () => void;
}

/** Consumes the sole NodeHandles finalizer producer; never creates another registry. */
export class VersionCollector {
  private readonly pending = new Map<bigint, Collection[]>();
  private cleanupVersion: bigint | undefined;
  private scheduled = false;
  private draining = false;
  private reschedule = false;
  private disposed = false;
  private observing = false;
  private sequence = 0;

  constructor(
    private readonly runtime: VersionCollectorRuntime,
    private readonly observe?: (event: VersionCollectorEvent) => void
  ) {}

  collect(version: bigint, unowned: () => boolean, released: () => void): void {
    this.checkObserver();
    if (this.disposed) return;
    if (version < 0n || version > 0xffffffffffffffffn)
      throw new Error('Collected version must be a native uint64');
    let owners = this.pending.get(version);
    if (owners === undefined) {
      owners = [];
      this.pending.set(version, owners);
    }
    owners.push({ unowned, released });
    this.event({ kind: 'queued', version });
    if (this.draining) this.reschedule = true;
    else this.schedule();
  }

  /** A queue fence only: true does not assert engine GC or all finalizers completed. */
  drain(): boolean {
    this.checkObserver();
    if (this.disposed || this.draining) return false;
    this.draining = true;
    this.reschedule = false;
    try {
      if (!this.flushCleanup()) return false;
      for (const version of [...this.pending.keys()]) {
        if (this.disposed) return false;
        this.retire(version);
        if (this.cleanupVersion !== undefined) return false;
      }
      return !this.disposed && this.pending.size === 0;
    } finally {
      this.draining = false;
      if (this.reschedule && !this.disposed) this.schedule();
    }
  }

  dispose(): void {
    this.checkObserver();
    if (this.disposed) return;
    this.disposed = true;
    this.pending.clear();
    this.cleanupVersion = undefined;
    this.event({ kind: 'disposed' });
  }

  private schedule(): void {
    if (this.scheduled || this.disposed) return;
    this.scheduled = true;
    try {
      this.runtime.scheduleDrain(() => {
        this.scheduled = false;
        this.drain();
      });
    } catch (error) {
      this.scheduled = false;
      throw error;
    }
  }

  private eligible(version: bigint): boolean {
    if (this.disposed) return false;
    const owners = this.pending.get(version);
    if (owners === undefined) return false;
    if (!owners.every((owner) => owner.unowned())) {
      this.pending.delete(version);
      this.event({ kind: 'cancelled', version });
      return false;
    }
    if (!this.runtime.canCollect(version)) {
      this.event({ kind: 'blocked', version, phase: 'before-release' });
      return false;
    }
    return true;
  }

  private retire(version: bigint): void {
    if (!this.eligible(version)) return;
    this.flush(version, 'before-release');
    // A native flush may invoke host callbacks and create replacement owners.
    if (!this.eligible(version)) return;
    const owners = [...(this.pending.get(version) ?? [])];
    this.event({ kind: 'release-start', version });
    try {
      this.runtime.releaseVersion(version);
    } catch (error) {
      this.event({ kind: 'failure', version, phase: 'release' });
      throw error;
    }
    // Only the submitted prefix is acknowledged. Requests reentered during the
    // native call belong to the next liveness check, not this receipt.
    const pending = this.pending.get(version);
    pending?.splice(0, owners.length);
    if (pending?.length === 0) this.pending.delete(version);
    this.event({ kind: 'release-ack', version });
    if (this.disposed) return;
    this.cleanupVersion = version;
    try {
      this.notify(owners);
    } finally {
      // These callbacks can drop mirror captures and enqueue further leases.
      // Debt survives a failed/blocked flush without repeating retirement.
      this.flushCleanup();
    }
  }

  private notify(owners: readonly Collection[]): void {
    let failed = false;
    let failure: unknown;
    for (const owner of owners)
      try {
        owner.released();
      } catch (error) {
        if (!failed) failure = error;
        failed = true;
      }
    if (failed) throw failure;
  }

  private flushCleanup(): boolean {
    const version = this.cleanupVersion;
    if (version === undefined) return !this.disposed;
    if (this.disposed) return false;
    if (!this.runtime.canCollect(version)) {
      this.event({ kind: 'blocked', version, phase: 'after-release' });
      return false;
    }
    this.flush(version, 'after-release');
    if (this.disposed) return false;
    this.cleanupVersion = undefined;
    return true;
  }

  private flush(version: bigint, phase: FlushPhase): void {
    this.event({ kind: 'lease-flush-start', version, phase });
    try {
      this.runtime.flushLeases();
    } catch (error) {
      this.event({ kind: 'failure', version, phase });
      throw error;
    }
    this.event({ kind: 'lease-flush-ack', version, phase });
  }

  private checkObserver(): void {
    if (this.observing)
      throw new Error('Version collector observer must not reenter');
  }

  private event(event: EventInput): void {
    if (this.observe === undefined) return;
    this.observing = true;
    try {
      this.observe({ ...event, sequence: ++this.sequence });
    } finally {
      this.observing = false;
    }
  }
}
