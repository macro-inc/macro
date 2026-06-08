import type { Listen } from '@solid-primitives/event-bus';
import { type DBSchema, type IDBPDatabase, openDB as idbOpen } from 'idb';
import type { RawUpdate } from './shared';
import type { LiveSyncSource, SyncSourceEvent, WALSyncSource } from './source';

export type WALEntry = {
  id: number;
  update: RawUpdate;
  /** True once the server has acked this update. Pruned at the next snapshot. */
  delivered: boolean;
  /** Epoch ms when the entry was appended. Used to drop stale undelivered edits. */
  createdAt: number;
};

export interface WALStore {
  append(update: RawUpdate): Promise<void>;
  getAll(): Promise<WALEntry[]>;
  /** Mark a set of entries as delivered (server acked). They remain in the
   *  store until pruneDelivered() is called after a successful snapshot save. */
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

const DB_NAME = 'macro-document-wal';
const DB_VERSION = 1;

// The "dirty hint" we keep in localStorage is just a best effort cache that
// let's us more quickly send out a request to ask sync service for updates. We
// could just use idb but it's simple and faster.
const DIRTY_HINT_KEY_PREFIX = 'macro-wal-dirty-';
const dirtyHintKey = (documentId: string) =>
  `${DIRTY_HINT_KEY_PREFIX}${documentId}`;

interface WALSchema extends DBSchema {
  updates: {
    key: number;
    value: {
      id?: number;
      documentId: string;
      update: Uint8Array;
      delivered: boolean;
      createdAt: number;
    };
    indexes: { documentId: string };
  };
}

export class BrowserWALStore implements WALStore {
  /** Resolves to the open IDB database, shared across all operations. */
  private _db: Promise<IDBPDatabase<WALSchema>>;

  private db(): Promise<IDBPDatabase<WALSchema>> {
    return this._db;
  }

  constructor(private readonly documentId: string) {
    this._db = idbOpen<WALSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('updates', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('documentId', 'documentId');
      },
    });
  }

  static isDirtyHint(documentId: string): boolean {
    return localStorage.getItem(dirtyHintKey(documentId)) === '1';
  }

  private setDirtyHint(): void {
    localStorage.setItem(dirtyHintKey(this.documentId), '1');
  }

  public async append(update: RawUpdate): Promise<void> {
    // Set the localStorage hint BEFORE writing to IDB so a crash between
    // the two leaves us in the "maybe dirty" state (safe) rather than
    // "clean but actually has entries" (dangerous).
    this.setDirtyHint();
    const db = await this.db();
    await db.add('updates', {
      documentId: this.documentId,
      update,
      delivered: false,
      createdAt: Date.now(),
    });
  }

  public markClean(): void {
    localStorage.removeItem(dirtyHintKey(this.documentId));
  }

  public async getAll(): Promise<WALEntry[]> {
    const db = await this.db();
    return db.getAllFromIndex(
      'updates',
      'documentId',
      this.documentId
    ) as Promise<WALEntry[]>;
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
      'documentId',
      this.documentId
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
      'documentId',
      this.documentId
    );
    const cutoff = Date.now() - ttlMs;
    const tx = db.transaction('updates', 'readwrite');
    const store = tx.objectStore('updates');
    let deleted = 0;
    for (const row of entries) {
      if (row.id !== undefined && row.createdAt < cutoff) {
        await store.delete(row.id);
        deleted++;
      }
    }
    await tx.done;
    return deleted;
  }

  public async count(): Promise<number> {
    const db = await this.db();
    return (await db.getAllFromIndex('updates', 'documentId', this.documentId))
      .length;
  }
}

export class IDBWALSyncSource implements WALSyncSource {
  /** True while a flush is in progress — prevents concurrent flushes. */
  private isFlushing = false;
  /** True if pushUpdate was called while a flush was in progress.
   *  Causes flush to re-run after completing so those entries aren't stranded. */
  private hasNewPending = false;
  public pendingFlush: Promise<void> = Promise.resolve();

  public readonly documentId: string;
  public readonly listen: Listen<SyncSourceEvent>;

  /**
   * Exists so that we can not "do stuff" until we have pruned expired entries
   * (like when snapshot loading occurs right after construction for example).
   */
  private readonly readyPromise: Promise<void>;

  constructor(
    private readonly live: LiveSyncSource,
    private readonly store: WALStore
  ) {
    this.documentId = live.documentId;
    this.listen = live.listen.bind(live);

    this.readyPromise = this.setup();

    live.listen((event) => {
      if (event.type === 'reconnect') void this.flush(); // unawaited
    });
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

  public async pushUpdate(update: RawUpdate): Promise<boolean> {
    await this.ready();
    await this.store.append(update);
    this.hasNewPending = true;
    void this.flush(); // unawaited
    return true;
  }

  public flush(): Promise<void> {
    if (this.isFlushing) return this.pendingFlush;
    this.pendingFlush = this.doFlush();
    return this.pendingFlush;
  }

  public pruneDelivered(): Promise<void> {
    return this.store.pruneDelivered();
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

      const delivered = await this.live.pushUpdate(
        undelivered.map((e) => e.update)
      );

      if (delivered) {
        await this.store.markDelivered(undelivered.map((e) => e.id));
        // Clear the dirty hint only if no new edits arrived during the flush.
        if (!this.hasNewPending) this.store.markClean();
      } else {
        console.warn('WAL flush: pushUpdate not acked', {
          scope: 'wal',
          documentId: this.documentId,
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

export function createWALSyncSource(live: LiveSyncSource): IDBWALSyncSource {
  return new IDBWALSyncSource(live, new BrowserWALStore(live.documentId));
}
