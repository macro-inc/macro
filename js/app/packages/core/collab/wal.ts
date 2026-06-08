import { logger } from '@observability/logger';
import type { Listen } from '@solid-primitives/event-bus';
import { type DBSchema, type IDBPDatabase, openDB as idbOpen } from 'idb';
import type { RawUpdate } from './shared';
import type { LiveSyncSource, SyncSourceEvent, WALSyncSource } from './source';

export type WALEntry = {
  id: number;
  update: RawUpdate;
  /** True once the server has acked this update. Pruned at the next snapshot. */
  delivered: boolean;
};

export interface WALStore {
  append(update: RawUpdate): Promise<void>;
  getAll(): Promise<WALEntry[]>;
  /** Mark a set of entries as delivered (server acked). They remain in the
   *  store until pruneDelivered() is called after a successful snapshot save. */
  markDelivered(ids: number[]): Promise<void>;
  /** Drop all delivered entries. Called by the snapshot tick after a save. */
  pruneDelivered(): Promise<void>;
  count(): Promise<number>;
}

const DB_NAME = 'macro-document-wal';
const DB_VERSION = 1;

interface WALSchema extends DBSchema {
  updates: {
    key: number;
    value: {
      id?: number;
      documentId: string;
      update: Uint8Array;
      delivered: boolean;
    };
    indexes: { documentId: string };
  };
}

export class IDBWALStore implements WALStore {
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

  public async append(update: RawUpdate): Promise<void> {
    const db = await this.db();
    await db.add('updates', {
      documentId: this.documentId,
      update,
      delivered: false,
    });
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

  constructor(
    private readonly live: LiveSyncSource,
    private readonly store: WALStore
  ) {
    this.documentId = live.documentId;
    this.listen = live.listen.bind(live);

    live.listen((event) => {
      if (event.type === 'reconnect') void this.flush(); // unawaited
    });
  }

  public async pushUpdate(update: RawUpdate): Promise<boolean> {
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
      } else {
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
  return new IDBWALSyncSource(live, new IDBWALStore(live.documentId));
}
