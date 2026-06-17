import { type DBSchema, type IDBPDatabase, openDB as idbOpen } from 'idb';
import type { RawUpdate } from './shared';
import type { LiveSyncSource } from './source';

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
  /** Signal that all entries have been delivered and nothing new is queued.
   *  Implementations may use this to clear a cached "dirty" hint. */
  markClean(): void;
  count(): Promise<number>;
}

/** Undelivered entries older than this are dropped without replay. */
export const WAL_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 1 week

/** DB name for the Loro doc-update WAL. Each WAL "purpose" (loro updates,
 *  offline comments, etc.) gets its own DB so schemas don't collide. */
export const LORO_WAL_DB_NAME = 'macro-document-wal';

const DB_VERSION = 1;

// The "dirty hint" we keep in localStorage is just a best effort cache that
// let's us more quickly send out a request to ask sync service for updates. We
// could just use idb but it's simple and faster.
const DIRTY_HINT_KEY_PREFIX = 'macro-wal-dirty-';
const dirtyHintKey = (dbName: string, scopeId: string) =>
  `${DIRTY_HINT_KEY_PREFIX}${dbName}-${scopeId}`;

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

export class BrowserWALStore<T> implements WALStore<T> {
  /** Resolves to the open IDB database, shared across all operations. */
  private _db: Promise<IDBPDatabase<WALSchema<T>>>;

  private db(): Promise<IDBPDatabase<WALSchema<T>>> {
    return this._db;
  }

  constructor(
    private readonly dbName: string,
    private readonly scopeId: string
  ) {
    this._db = BrowserWALStore.openDb<T>(dbName);
  }

  private static openDb<U>(
    dbName: string
  ): Promise<IDBPDatabase<WALSchema<U>>> {
    return idbOpen<WALSchema<U>>(dbName, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('updates', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('scopeId', 'scopeId');
      },
    });
  }

  static isDirtyHint(dbName: string, scopeId: string): boolean {
    return localStorage.getItem(dirtyHintKey(dbName, scopeId)) === '1';
  }

  /** List every scopeId that currently has at least one entry. Uses a
   *  unique-key cursor on the `scopeId` index, so it doesn't load entries. */
  static async listScopeIds(dbName: string): Promise<string[]> {
    const db = await BrowserWALStore.openDb<unknown>(dbName);
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
  }

  private setDirtyHint(): void {
    localStorage.setItem(dirtyHintKey(this.dbName, this.scopeId), '1');
  }

  public async append(update: T): Promise<void> {
    // Set the localStorage hint BEFORE writing to IDB so a crash between
    // the two leaves us in the "maybe dirty" state (safe) rather than
    // "clean but actually has entries" (dangerous).
    this.setDirtyHint();
    const db = await this.db();
    await db.add('updates', {
      scopeId: this.scopeId,
      update,
      delivered: false,
      createdAt: Date.now(),
    });
  }

  public markClean(): void {
    localStorage.removeItem(dirtyHintKey(this.dbName, this.scopeId));
  }

  public async getAll(): Promise<WALEntry<T>[]> {
    const db = await this.db();
    return db.getAllFromIndex('updates', 'scopeId', this.scopeId) as Promise<
      WALEntry<T>[]
    >;
  }

  public async markDelivered(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const db = await this.db();
    const tx = db.transaction('updates', 'readwrite');
    const store = tx.objectStore('updates');
    for (const id of ids) {
      const row = await store.get(id);
      if (row) await store.put({ ...row, delivered: true });
    }
    await tx.done;
  }

  public async pruneDelivered(): Promise<void> {
    const db = await this.db();
    const entries = await db.getAllFromIndex(
      'updates',
      'scopeId',
      this.scopeId
    );
    const tx = db.transaction('updates', 'readwrite');
    const store = tx.objectStore('updates');
    for (const row of entries) {
      if (row.delivered && row.id !== undefined) {
        await store.delete(row.id);
      }
    }
    await tx.done;
  }

  public async pruneExpired(ttlMs: number): Promise<number> {
    const db = await this.db();
    const entries = await db.getAllFromIndex(
      'updates',
      'scopeId',
      this.scopeId
    );
    const cutoff = Date.now() - ttlMs;
    const tx = db.transaction('updates', 'readwrite');
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
    const db = await this.db();
    return (await db.getAllFromIndex('updates', 'scopeId', this.scopeId))
      .length;
  }
}

/**
 * Append-only queue with retry semantics. Caller-supplied `push` does the
 * actual transport; the syncer handles persistence, batching, dedupe, and
 * markClean coordination. Triggering flushes on transport reconnect (or
 * other "try again" signals) is the caller's responsibility.
 */
export class WALSyncer<T> {
  /** True while a flush is in progress — prevents concurrent flushes. */
  private isFlushing = false;
  /** True if append was called while a flush was in progress. Causes flush
   *  to re-run after completing so those entries aren't stranded. */
  private hasNewPending = false;
  public pendingFlush: Promise<void> = Promise.resolve();
  private cleanupFns: Array<() => void> = [];

  /**
   * Exists so that we can not "do stuff" until we have pruned expired entries
   * (like when snapshot loading occurs right after construction for example).
   */
  private readonly readyPromise: Promise<void>;

  constructor(
    private readonly store: WALStore<T>,
    private readonly push: (items: T[]) => Promise<boolean>
  ) {
    this.readyPromise = this.setup();
  }

  /* Right now just drops expired entries. */
  private async setup(): Promise<void> {
    const deleted = await this.store.pruneExpired(WAL_TTL_MS);
    if (deleted > 0) {
      console.warn(`WAL: dropped expired entries (count: ${deleted})`);
    }
  }

  public ready(): Promise<void> {
    return this.readyPromise;
  }

  public async append(item: T): Promise<void> {
    await this.ready();
    await this.store.append(item);
    this.hasNewPending = true;
    void this.flush(); // unawaited
  }

  public flush(): Promise<void> {
    if (this.isFlushing) return this.pendingFlush;
    this.pendingFlush = this.doFlush();
    return this.pendingFlush;
  }

  public pruneDelivered(): Promise<void> {
    return this.store.pruneDelivered();
  }

  public destroy(): void {
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

      const delivered = await this.push(undelivered.map((e) => e.update));

      if (delivered) {
        await this.store.markDelivered(undelivered.map((e) => e.id));
        // Clear the dirty hint only if no new edits arrived during the flush.
        if (!this.hasNewPending) this.store.markClean();
      } else {
        console.warn('WAL flush: push not acked', {
          count: undelivered.length,
        });
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
  const syncer = new WALSyncer<RawUpdate>(store, (updates) =>
    live.pushUpdate(updates)
  );
  live.listen((event) => {
    if (event.type === 'reconnect') void syncer.flush();
  });
  return syncer;
}
