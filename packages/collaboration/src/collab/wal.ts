import {
  BrowserWALStore,
  type WALStore,
} from '@macro-inc/browser-store/wal-store';
import type { Span } from '@macro-inc/observability';
import { logSyncService, type WalContext } from './logger';
import type { RawUpdate } from './shared';
import type { LiveSyncSource } from './source';
import { telemetrySpan } from './telemetry';

/** Undelivered entries older than this are dropped without replay. */
export const WAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/** DB name for the Loro doc-update WAL. Each WAL "purpose" (loro updates,
 *  offline comments, etc.) gets its own DB so schemas don't collide. */
export const LORO_WAL_DB_NAME = 'macro-document-wal';

/** The durable, not-yet-delivered edits of one document. */
export function createDocumentWALStore(
  documentId: string
): WALStore<RawUpdate> {
  return new BrowserWALStore<RawUpdate>(LORO_WAL_DB_NAME, documentId);
}

/**
 * Append-only queue with retry semantics. Caller-supplied `push` does the
 * actual transport; the syncer handles persistence, batching, and dedupe.
 * Triggering flushes on transport reconnect (or other "try again" signals)
 * is the caller's responsibility.
 */
export class WALSyncer<T> {
  /** True while a flush is in progress — prevents concurrent flushes. */
  private isFlushing = false;
  /** True if append was called while a flush was in progress. Causes flush
   *  to re-run after completing so those entries aren't stranded. */
  private hasNewPending = false;
  public pendingFlush: Promise<void> = Promise.resolve();
  private cleanupFns: Array<() => void> = [];
  private deliveryOutage:
    | {
        id: string;
        span: Span;
        startedAt: number;
        failedAttempts: number;
        maxUndelivered: number;
      }
    | undefined;

  /**
   * Exists so that we can not "do stuff" until we have pruned expired entries
   * (like when snapshot loading occurs right after construction for example).
   */
  private readonly readyPromise: Promise<void>;

  constructor(
    private readonly store: WALStore<T>,
    private readonly push: (items: T[]) => Promise<boolean>,
    private readonly label?: string
  ) {
    this.readyPromise = this.setup();
  }

  /* Right now just drops expired entries. */
  private async setup(): Promise<void> {
    const deleted = await this.store.pruneExpired(WAL_TTL_MS);
    if (deleted > 0 && this.label) {
      logSyncService({
        documentId: this.label,
        level: 'warn',
        context: { wal: await this.summary() },
        message: `WAL: dropped ${deleted} expired entries`,
      });
    }
  }

  public ready(): Promise<void> {
    return this.readyPromise;
  }

  public async append(item: T): Promise<void> {
    await this.ready();
    await this.store.append(item);
    if (this.label)
      logSyncService({
        documentId: this.label,
        level: 'debug',
        context: { wal: await this.summary() },
        message: 'WAL: wrote to IDB',
      });
    this.hasNewPending = true;
    void this.flush(); // unawaited
  }

  public flush(): Promise<void> {
    if (this.label)
      logSyncService({
        documentId: this.label,
        level: 'debug',
        context: {},
        message: `WAL flush: triggered (isFlushing=${this.isFlushing})`,
      });
    if (this.isFlushing) return this.pendingFlush;
    this.pendingFlush = this.doFlush();
    return this.pendingFlush;
  }

  public pruneDelivered(): Promise<void> {
    return this.store.pruneDelivered();
  }

  public async summary(): Promise<WalContext> {
    const entries = await this.store.getAll();
    const undelivered = entries.filter((e) => !e.delivered);
    return {
      count: entries.length,
      dirty: undelivered.length,
      mostRecentEdit: undelivered.at(-1)?.createdAt,
    };
  }

  public destroy(): void {
    if (this.deliveryOutage) {
      this.deliveryOutage.span.setAttr('outcome', 'abandoned');
      this.finishDeliveryOutage();
    }
    for (const fn of this.cleanupFns) fn();
    this.cleanupFns = [];
  }

  public addCleanup(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  private async doFlush(): Promise<void> {
    await this.ready();

    this.isFlushing = true;
    this.hasNewPending = false;
    let succeeded = true;

    try {
      const entries = await this.store.getAll();
      const undelivered = entries.filter((e) => !e.delivered);
      if (undelivered.length === 0) return; // nothing to do

      if (this.label)
        logSyncService({
          documentId: this.label,
          level: 'debug',
          context: { wal: await this.summary() },
          message: `WAL flush: pushing ${undelivered.length} entries`,
        });

      let delivered: boolean;
      try {
        delivered = await this.push(undelivered.map((e) => e.update));
      } catch (e) {
        this.recordDeliveryFailure('push_error', undelivered.length, e);
        throw e;
      }

      if (delivered) {
        await this.store.markDelivered(undelivered.map((e) => e.id));
        this.recordDeliveryRecovery(undelivered.length);
        if (this.label)
          logSyncService({
            documentId: this.label,
            level: 'debug',
            context: { wal: await this.summary() },
            message: `WAL flush: delivered ${undelivered.length} entries`,
          });
      } else {
        this.recordDeliveryFailure('not_acked', undelivered.length);
        succeeded = false;
      }
    } finally {
      this.isFlushing = false;
    }

    if (succeeded && this.hasNewPending) {
      this.pendingFlush = this.doFlush();
      return this.pendingFlush;
    }
  }

  private recordDeliveryFailure(
    kind: 'not_acked' | 'push_error',
    undelivered: number,
    error?: unknown
  ): void {
    if (!this.label) return;

    if (this.deliveryOutage) {
      this.deliveryOutage.failedAttempts++;
      this.deliveryOutage.maxUndelivered = Math.max(
        this.deliveryOutage.maxUndelivered,
        undelivered
      );
      this.deliveryOutage.span.setAttr(
        'wal.failed_attempts',
        this.deliveryOutage.failedAttempts
      );
      this.deliveryOutage.span.setAttr(
        'wal.max_undelivered',
        this.deliveryOutage.maxUndelivered
      );
      return;
    }

    const id = crypto.randomUUID();
    const span = telemetrySpan(this.label, 'wal.delivery_outage');
    span.setAttr('wal.outage.id', id);
    span.setAttr('wal.first_failure', kind);
    span.setAttr('wal.failed_attempts', 1);
    span.setAttr('wal.max_undelivered', undelivered);
    span.error(error ?? 'push not acked; entries remain undelivered');
    this.deliveryOutage = {
      id,
      span,
      startedAt: Date.now(),
      failedAttempts: 1,
      maxUndelivered: undelivered,
    };
    logSyncService({
      documentId: this.label,
      level: 'warn',
      context: {
        misc: {
          'wal.outage.id': id,
          'wal.first_failure': kind,
          'wal.undelivered': undelivered,
        },
      },
      message: `WAL delivery outage started (${undelivered} entries)`,
    });
  }

  private recordDeliveryRecovery(delivered: number): void {
    if (!this.deliveryOutage || !this.label) return;

    const { id, span, startedAt, failedAttempts, maxUndelivered } =
      this.deliveryOutage;
    const outageMs = Date.now() - startedAt;
    span.event('wal.ack.confirmed', { 'wal.delivered': delivered });
    span.setAttr('outcome', 'recovered');
    span.setAttr('wal.outage_ms', outageMs);
    span.setAttr('wal.failed_attempts', failedAttempts);
    span.setAttr('wal.max_undelivered', maxUndelivered);
    span.setAttr('wal.delivered', delivered);
    span.end();
    this.deliveryOutage = undefined;
    logSyncService({
      documentId: this.label,
      level: 'info',
      context: {
        misc: {
          'wal.outage.id': id,
          'wal.outage_ms': outageMs,
          'wal.failed_attempts': failedAttempts,
          'wal.max_undelivered': maxUndelivered,
          'wal.delivered': delivered,
        },
      },
      message: 'WAL delivery recovered',
    });
  }

  private finishDeliveryOutage(): void {
    if (!this.deliveryOutage) return;
    this.deliveryOutage.span.setAttr(
      'wal.outage_ms',
      Date.now() - this.deliveryOutage.startedAt
    );
    this.deliveryOutage.span.end();
    this.deliveryOutage = undefined;
  }
}

/** Build a WAL syncer wired to a Loro live sync source: BrowserWALStore for
 *  persistence, live.pushUpdate as the transport, and reconnect events
 *  trigger a re-flush. */
export function createWALSyncSource(
  live: LiveSyncSource
): WALSyncer<RawUpdate> {
  const syncer = new WALSyncer<RawUpdate>(
    createDocumentWALStore(live.documentId),
    (updates) => live.pushUpdate(updates),
    live.documentId
  );
  live.listen((event) => {
    if (event.type === 'reconnect') void syncer.flush();
  });
  return syncer;
}
