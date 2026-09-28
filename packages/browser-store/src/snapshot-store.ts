import { type DBSchema, type IDBPDatabase, openDB } from 'idb';
import type { StoreLogger } from './logger';

/** One value per scope, replaced whole on every save. */
export interface SnapshotStore<T> {
  save(snapshot: T): Promise<void>;
  load(): Promise<T | null>;
  delete(): Promise<void>;
}

const DB_VERSION = 1;
const STORE = 'snapshots';

interface SnapshotSchema<T> extends DBSchema {
  snapshots: {
    key: string;
    value: { scopeId: string; snapshot: T };
  };
}

/** A saved snapshot with the scope it was saved under. */
export type ScopedSnapshot<T> = { scopeId: string; snapshot: T };

function open<T>(dbName: string): Promise<IDBPDatabase<SnapshotSchema<T>>> {
  return openDB<SnapshotSchema<T>>(dbName, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore(STORE, { keyPath: 'scopeId' });
    },
  });
}

export class IDBSnapshotStore<T> implements SnapshotStore<T> {
  private db: Promise<IDBPDatabase<SnapshotSchema<T>>>;

  constructor(
    dbName: string,
    private readonly scopeId: string,
    private readonly logger?: StoreLogger
  ) {
    this.db = open<T>(dbName);
  }

  /** Drop every scope's snapshot in `dbName`. */
  static async clear(dbName: string): Promise<void> {
    const db = await open<unknown>(dbName);
    await db.clear(STORE);
  }

  /**
   * Delete the scopes `select` names, given every saved snapshot in
   * `dbName`. Loads every value, so this is for an occasional sweep (a
   * time-to-live, a cap on entries), not a hot path.
   */
  static async prune<T>(
    dbName: string,
    select: (saved: ScopedSnapshot<T>[]) => string[]
  ): Promise<number> {
    const db = await open<T>(dbName);
    const saved = await db.getAll(STORE);
    const doomed = select(saved);
    if (doomed.length === 0) return 0;
    const tx = db.transaction(STORE, 'readwrite');
    for (const scopeId of doomed) void tx.store.delete(scopeId);
    await tx.done;
    return doomed.length;
  }

  public async save(snapshot: T): Promise<void> {
    const db = await this.db;
    await db.put(STORE, { scopeId: this.scopeId, snapshot });
    this.logger?.debug('snapshot-store: saved to IDB');
  }

  public async load(): Promise<T | null> {
    const db = await this.db;
    const row = await db.get(STORE, this.scopeId);
    const found = row?.snapshot ?? null;
    this.logger?.debug(
      found
        ? 'snapshot-store: loaded from IDB'
        : 'snapshot-store: no snapshot found'
    );
    return found;
  }

  public async delete(): Promise<void> {
    const db = await this.db;
    await db.delete(STORE, this.scopeId);
  }
}

export class InMemorySnapshotStore<T> implements SnapshotStore<T> {
  private snapshot: T | null = null;

  public async save(snapshot: T): Promise<void> {
    this.snapshot = snapshot;
  }

  public async load(): Promise<T | null> {
    return this.snapshot;
  }

  public async delete(): Promise<void> {
    this.snapshot = null;
  }
}
