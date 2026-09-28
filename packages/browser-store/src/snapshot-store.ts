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

export class IDBSnapshotStore<T> implements SnapshotStore<T> {
  private db: Promise<IDBPDatabase<SnapshotSchema<T>>>;

  constructor(
    dbName: string,
    private readonly scopeId: string,
    private readonly logger?: StoreLogger
  ) {
    this.db = openDB<SnapshotSchema<T>>(dbName, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'scopeId' });
      },
    });
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
