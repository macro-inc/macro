import type { Span } from '@macro-inc/observability';
import { type DBSchema, type IDBPDatabase, openDB as idbOpen } from 'idb';
import { logSyncService, type WalContext } from './logger';
import { RecoverableDatabase } from './recoverable-database';
import type { RawUpdate } from './shared';
import type { LiveSyncSource } from './source';
import { telemetrySpan } from './telemetry';

export type WALEntry<T> = {
  id: number;
  update: T;
  /** True once the entry has been acked by its transport. Pruned at the next snapshot. */
  delivered: boolean;
  /** Epoch ms when the entry was appended. Used to drop stale undelivered edits. */
  createdAt: number;
};

function hasId<T>(
  entry: Omit<WALEntry<T>, 'id'> & { id?: number }
): entry is WALEntry<T> {
  return entry.id !== undefined;
}

export function hasExpired<T>(entry: WALEntry<T>, cutoff: number): boolean {
  return !entry.delivered && entry.createdAt < cutoff;
}

export interface WALStore<T> {
  append(update: T): Promise<void>;
  getAll(): Promise<WALEntry<T>[]>;
  /** Mark a set of entries as delivered (acked by transport). They remain in
   *  the store until pruneDelivered() is called. */
  markDelivered(ids: number[]): Promise<void>;
  /** Drop all delivered entries. Called by the snapshot tick after a save. */
  pruneDelivered(): Promise<void>;
  /** Drop entries older than `ttlMs`. Returns the number deleted. */
  pruneExpired(ttlMs: number): Promise<number>;
  count(): Promise<number>;
}

/** Undelivered entries older than this are dropped without replay. */
export const WAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/** DB name for the Loro doc-update WAL. Each WAL "purpose" (loro updates,
 *  offline comments, etc.) gets its own DB so schemas don't collide. */
export const LORO_WAL_DB_NAME = 'macro-document-wal';

const DB_VERSION = 1;

interface WALSchema<T> extends DBSchema {
  updates: {
    key: number;
    value: {
      id?: number;
      scopeId: string;
      update: T;
      delivered: boolean;
      createdAt: number;
    };
    indexes: { scopeId: string };
  };
}

function upgradeWAL<T>(db: IDBPDatabase<WALSchema<T>>): void {
  const store = db.createObjectStore('updates', {
    keyPath: 'id',
    autoIncrement: true,
  });
  store.createIndex('scopeId', 'scopeId');
}

export class BrowserWALStore<T> implements WALStore<T> {
  private readonly database: RecoverableDatabase<WALSchema<T>>;

  constructor(
    dbName: string,
    private readonly scopeId: string
  ) {
    this.database = new RecoverableDatabase(dbName, DB_VERSION, upgradeWAL);
  }

  /** List every scopeId that currently has at least one entry. Uses a
   *  unique-key cursor on the `scopeId` index, so it doesn't load entries. */
  static async listScopeIds(dbName: string): Promise<string[]> {
    const db = await idbOpen<WALSchema<unknown>>(dbName, DB_VERSION, {
      upgrade: upgradeWAL,
    });
    try {
      const scopeIds: string[] = [];
      let cursor = await db
        .transaction('updates')
        .store.index('scopeId')
        .openKeyCursor(null, 'nextunique');
      while (cursor) {
        scopeIds.push(cursor.key);
        cursor = await cursor.continue();
      }
      return scopeIds;
    } finally {
      db.close();
    }
  }

  public async append(update: T): Promise<void> {
    const entry = {
      scopeId: this.scopeId,
      update,
      delivered: false,
      createdAt: Date.now(),
    };
    for (let attempt = 0; ; attempt++) {
      const tx = await this.database.transaction('updates', 'readwrite');
      // A rejected request alone does not prove rollback. Wait for the native
      // transaction outcome before deciding whether replay is safe.
      const aborted = new Promise<boolean>((resolve) => {
        tx.addEventListener('abort', () => resolve(true), { once: true });
        tx.addEventListener('complete', () => resolve(false), { once: true });
      });
      try {
        // Wrap synchronous request errors too, so tx.done is always observed.
        const write = async () => tx.store.add(entry);
        await Promise.all([write(), tx.done]);
        return;
      } catch (error) {
        const rolledBack = await aborted;
        if (
          attempt === 1 ||
          !rolledBack ||
          (tx.error !== null && tx.error.name !== 'AbortError') ||
          !(error instanceof DOMException) ||
          error.name !== 'AbortError'
        ) {
          throw tx.error ?? error;
        }
      }
    }
  }

  public async getAll(): Promise<WALEntry<T>[]> {
    const tx = await this.database.transaction('updates', 'readonly');
    return tx.store.index('scopeId').getAll(this.scopeId) as Promise<
      WALEntry<T>[]
    >;
  }

  public async markDelivered(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const tx = await this.database.transaction('updates', 'readwrite');
    const store = tx.objectStore('updates');
    for (const id of ids) {
      const row = await store.get(id);
      if (row) await store.put({ ...row, delivered: true });
    }
    await tx.done;
  }

  public async pruneDelivered(): Promise<void> {
    const entries = await this.getAll();
    const tx = await this.database.transaction('updates', 'readwrite');
    const store = tx.objectStore('updates');
    for (const row of entries) {
      if (row.delivered && row.id !== undefined) {
        await store.delete(row.id);
      }
    }
    await tx.done;
  }

  public async pruneExpired(ttlMs: number): Promise<number> {
    const entries = await this.getAll();
    const cutoff = Date.now() - ttlMs;
    const tx = await this.database.transaction('updates', 'readwrite');
    const store = tx.objectStore('updates');
    let deleted = 0;
    for (const row of entries) {
      if (hasId(row) && hasExpired(row, cutoff)) {
        await store.delete(row.id);
        deleted++;
      }
    }
    await tx.done;
    return deleted;
  }

  public async count(): Promise<number> {
    return (await this.getAll()).length;
  }
}

export class InMemoryWALStore<T> implements WALStore<T> {
  private entries: WALEntry<T>[] = [];
  private seq = 0;

  async append(update: T): Promise<void> {
    this.entries.push({
      id: ++this.seq,
      update,
      delivered: false,
      createdAt: Date.now(),
    });
  }

  async getAll(): Promise<WALEntry<T>[]> {
    return [...this.entries];
  }

  async markDelivered(ids: number[]): Promise<void> {
    const set = new Set(ids);
    for (const e of this.entries) if (set.has(e.id)) e.delivered = true;
  }

  async pruneDelivered(): Promise<void> {
    this.entries = this.entries.filter((e) => !e.delivered);
  }

  async pruneExpired(ttlMs: number): Promise<number> {
    const cutoff = Date.now() - ttlMs;
    const before = this.entries.length;
    this.entries = this.entries.filter((e) => !hasExpired(e, cutoff));
    return before - this.entries.length;
  }

  async count(): Promise<number> {
    return this.entries.length;
  }
}

/**
 * Append-only queue with retry semantics. Caller-supplied `push` does the
 * actual transport; the syncer handles persistence, batching, and dedupe.
 * Triggering flushes on transport reconnect (or other "try again" signals)
 * is the caller's responsibility.
 */
function oldestUndelivered(
  entries: readonly WALEntry<unknown>[]
): number | undefined {
  let oldest: number | undefined;
  for (const entry of entries) {
    if (!entry.delivered && (oldest === undefined || entry.createdAt < oldest))
      oldest = entry.createdAt;
  }
  return oldest;
}

export class WALSyncer<T> {
  /** True while a flush is in progress — prevents concurrent flushes. */
  private isFlushing = false;
  /** True if append was called while a flush was in progress. Causes flush
   *  to re-run after completing so those entries aren't stranded. */
  private hasNewPending = false;
  private reportedFailures = new Map<'initialization' | 'flush', string>();
  /** Appends still writing to the store; see {@link flushPending}. */
  private readonly writes = new Set<Promise<void>>();
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

  /** When this syncer started; see {@link pendingSince}. */
  private readonly startedAt = Date.now();
  private pending: number | undefined;
  /** Bumped by every append, so a store read that started before an append
   *  cannot clear the pending state that append set. */
  private appends = 0;
  private refreshes = 0;
  /** When an edit failed to reach the store. It never gets sent, and the
   *  server can't apply later edits without it, so it stays pending for the
   *  rest of this session. */
  private lostAt: number | undefined;
  private readonly pendingListeners = new Set<
    (since: number | undefined) => void
  >();

  /**
   * Exists so that we can not "do stuff" until we have pruned expired entries
   * (like when snapshot loading occurs right after construction for example).
   */
  private readyPromise?: Promise<void>;

  constructor(
    private readonly store: WALStore<T>,
    private readonly push: (items: T[]) => Promise<boolean>,
    private readonly label?: string
  ) {
    void this.ready();
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
    if (!this.readyPromise) {
      this.readyPromise = this.setup();
      void this.observeSetup(this.readyPromise);
    }
    return this.readyPromise;
  }

  private async observeSetup(setup: Promise<void>): Promise<void> {
    try {
      await setup;
      this.reportedFailures.delete('initialization');
      // Not part of setup: appends don't wait for this read.
      await this.refreshPending();
    } catch (error) {
      // Retry only on the next caller's request, sharing any in-flight setup.
      if (this.readyPromise === setup) this.readyPromise = undefined;
      this.reportFailure('initialization', error);
    }
  }

  public async append(item: T): Promise<void> {
    const appended = this.appendEntry(item);
    this.writes.add(appended);
    try {
      await appended;
    } finally {
      this.writes.delete(appended);
    }
  }

  /** Waits for appends still writing to the store, then flushes. */
  public async flushPending(): Promise<void> {
    await Promise.allSettled([...this.writes]);
    await this.flush();
  }

  private async appendEntry(item: T): Promise<void> {
    try {
      await this.ready();
      await this.store.append(item);
    } catch (error) {
      this.lostAt ??= Date.now();
      if (this.pending === undefined) this.setPending(this.lostAt);
      throw error;
    }
    this.appends++;
    if (this.pending === undefined) this.setPending(Date.now());
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
    this.isFlushing = true;
    this.pendingFlush = this.doFlush();
    // Observe the same promise we return: awaited callers still see failures,
    // while timer/reconnect callers cannot create unhandled rejections.
    void this.observeFlush(this.pendingFlush);
    return this.pendingFlush;
  }

  private async observeFlush(flush: Promise<void>): Promise<void> {
    try {
      await flush;
      this.reportedFailures.delete('flush');
    } catch (error) {
      this.reportFailure('flush', error);
    }
  }

  private reportFailure(
    stage: 'initialization' | 'flush',
    error: unknown
  ): void {
    const details = {
      errName: error instanceof Error ? error.name : undefined,
      errMessage: error instanceof Error ? error.message : String(error),
      errStack: error instanceof Error ? error.stack : undefined,
    };
    const fingerprint = JSON.stringify(details);
    if (this.reportedFailures.get(stage) === fingerprint) return;
    this.reportedFailures.set(stage, fingerprint);
    logSyncService({
      documentId: this.label ?? 'unknown',
      level: 'error',
      context: { misc: { ...details, 'wal.stage': stage } },
      message: `WAL ${stage} failed; retrying on the next trigger`,
    });
  }

  public pruneDelivered(): Promise<void> {
    return this.store.pruneDelivered();
  }

  /**
   * When the oldest edit still waiting for the server was written, or
   * undefined when every edit has been delivered. Edits left by an earlier
   * session count from this syncer's start, so reopening a document with old
   * pending edits doesn't report them as long overdue before a first try.
   */
  public pendingSince(): number | undefined {
    return this.pending;
  }

  /** Calls `listener` whenever {@link pendingSince} changes. */
  public onPendingChange(
    listener: (since: number | undefined) => void
  ): () => void {
    this.pendingListeners.add(listener);
    return () => this.pendingListeners.delete(listener);
  }

  private setPending(since: number | undefined): void {
    if (since === this.pending) return;
    this.pending = since;
    for (const listener of this.pendingListeners) listener(since);
  }

  /** Rereads the store. Only the latest read applies, and a read that finds
   *  nothing pending doesn't clear an append that landed after it started. */
  private async refreshPending(): Promise<void> {
    try {
      await this.readEntries();
    } catch {
      // Keep the last answer; the next flush or append rereads.
    }
  }

  /** Reads every entry and updates {@link pendingSince} from them, so each
   *  flush also corrects a pending state another tab's delivery or a failed
   *  earlier read left stale. */
  private async readEntries(): Promise<WALEntry<T>[]> {
    const refresh = ++this.refreshes;
    const appends = this.appends;
    const entries = await this.store.getAll();
    if (refresh !== this.refreshes) return entries;
    const oldest = oldestUndelivered(entries);
    // A read that finds nothing pending may have missed an append that landed
    // while it ran. That append's own flush reads again and corrects it.
    if (oldest === undefined && appends !== this.appends) return entries;
    this.applyPending(oldest);
    return entries;
  }

  private applyPending(oldest: number | undefined): void {
    const since = [
      oldest === undefined ? undefined : Math.max(oldest, this.startedAt),
      this.lostAt,
    ].filter((time) => time !== undefined);
    this.setPending(since.length ? Math.min(...since) : undefined);
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
    this.pendingListeners.clear();
  }

  public addCleanup(fn: () => void): void {
    this.cleanupFns.push(fn);
  }

  private async doFlush(): Promise<void> {
    this.hasNewPending = false;
    let succeeded = true;

    try {
      await this.ready();
      const entries = await this.readEntries();
      const undelivered = entries.filter((e) => !e.delivered);
      // With nothing to send, still fall through: an edit appended while the
      // store was read needs the follow-up flush below.
      if (undelivered.length > 0) succeeded = await this.deliver(undelivered);
    } finally {
      this.isFlushing = false;
    }

    if (succeeded && this.hasNewPending) {
      this.isFlushing = true;
      this.pendingFlush = this.doFlush();
      return this.pendingFlush;
    }
  }

  /** Pushes `undelivered` and marks it delivered once acked; false when the
   *  server didn't ack it. */
  private async deliver(undelivered: WALEntry<T>[]): Promise<boolean> {
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

    if (!delivered) {
      this.recordDeliveryFailure('not_acked', undelivered.length);
      return false;
    }
    await this.store.markDelivered(undelivered.map((e) => e.id));
    await this.refreshPending();
    this.recordDeliveryRecovery(undelivered.length);
    if (this.label)
      logSyncService({
        documentId: this.label,
        level: 'debug',
        context: { wal: await this.summary() },
        message: `WAL flush: delivered ${undelivered.length} entries`,
      });
    return true;
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
  const store = new BrowserWALStore<RawUpdate>(
    LORO_WAL_DB_NAME,
    live.documentId
  );
  const syncer = new WALSyncer<RawUpdate>(
    store,
    (updates) => live.pushUpdate(updates),
    live.documentId
  );
  live.listen((event) => {
    if (event.type === 'reconnect') void syncer.flush();
  });
  return syncer;
}
