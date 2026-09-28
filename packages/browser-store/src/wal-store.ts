import { type DBSchema, type IDBPDatabase, openDB } from 'idb';

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

export class BrowserWALStore<T> implements WALStore<T> {
  /** Resolves to the open IDB database, shared across all operations. */
  private _db: Promise<IDBPDatabase<WALSchema<T>>>;

  private db(): Promise<IDBPDatabase<WALSchema<T>>> {
    return this._db;
  }

  constructor(
    dbName: string,
    private readonly scopeId: string
  ) {
    this._db = BrowserWALStore.openDb<T>(dbName);
  }

  private static openDb<U>(
    dbName: string
  ): Promise<IDBPDatabase<WALSchema<U>>> {
    return openDB<WALSchema<U>>(dbName, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('updates', {
          keyPath: 'id',
          autoIncrement: true,
        });
        store.createIndex('scopeId', 'scopeId');
      },
    });
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

  public async append(update: T): Promise<void> {
    const db = await this.db();
    await db.add('updates', {
      scopeId: this.scopeId,
      update,
      delivered: false,
      createdAt: Date.now(),
    });
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
