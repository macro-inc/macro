import type { DBSchema } from 'idb';
import { logSyncService } from './logger';
import { type LoroManager, LoroManagerError } from './manager';
import { RecoverableDatabase } from './recoverable-database';
import type { GenericRootSchema, RawUpdate } from './shared';
import type { WALStore } from './wal';

export interface SnapshotStore<T> {
  save(snapshot: T): Promise<void>;
  load(): Promise<T | null>;
  delete(): Promise<void>;
}

/** DB name for the Loro doc-snapshot store. */
export const LORO_SNAPSHOT_DB_NAME = 'macro-document-snapshots';

const DB_VERSION = 1;
const STORE = 'snapshots';

interface SnapshotSchema<T> extends DBSchema {
  snapshots: {
    key: string;
    value: { scopeId: string; snapshot: T };
  };
}

export class IDBSnapshotStore<T> implements SnapshotStore<T> {
  private readonly database: RecoverableDatabase<SnapshotSchema<T>>;

  constructor(
    dbName: string,
    private readonly scopeId: string
  ) {
    this.database = new RecoverableDatabase(dbName, DB_VERSION, (db) => {
      db.createObjectStore(STORE, { keyPath: 'scopeId' });
    });
  }

  public async save(snapshot: T): Promise<void> {
    const tx = await this.database.transaction(STORE, 'readwrite');
    await Promise.all([
      tx.store.put({ scopeId: this.scopeId, snapshot }),
      tx.done,
    ]);
    logSyncService({
      documentId: this.scopeId,
      level: 'debug',
      context: {},
      message: 'snapshot-store: saved to IDB',
    });
  }

  public async load(): Promise<T | null> {
    const tx = await this.database.transaction(STORE, 'readonly');
    const row = await tx.store.get(this.scopeId);
    const found = row?.snapshot ?? null;
    logSyncService({
      documentId: this.scopeId,
      level: 'debug',
      context: {},
      message: found
        ? 'snapshot-store: loaded from IDB'
        : 'snapshot-store: no snapshot found',
    });
    return found;
  }

  public async delete(): Promise<void> {
    const tx = await this.database.transaction(STORE, 'readwrite');
    await Promise.all([tx.store.delete(this.scopeId), tx.done]);
  }
}

/**
 * Bootstrap a Loro doc from cached state: load the last snapshot, then replay
 * any pending WAL entries on top. Returns whether a cached snapshot was
 * applied.
 */
export async function loadCachedState<S extends GenericRootSchema>(
  loroManager: LoroManager<S>,
  snapshotStore: SnapshotStore<RawUpdate>,
  walStore: WALStore<RawUpdate>
): Promise<boolean> {
  const snapshot = await snapshotStore.load();
  if (!snapshot) return false;

  const initResult = await loroManager.initializeFromSnapshot(snapshot);
  if (initResult.isErr()) {
    logSyncService({
      documentId: 'unknown',
      level: 'warn',
      context: {},
      message: 'snapshot-store: failed to initialize from snapshot',
    });
    // Stale or corrupt snapshot. We might just keep getting this error, so
    // let's drop it.
    await snapshotStore.delete();
    return false;
  }

  const pending = await walStore.getAll();
  let pendingCount = 0;
  for (const entry of pending) {
    const importResult = loroManager.importUpdate(entry.update);
    if (importResult.isErr()) {
      const pendingOnly = importResult.error.every(
        (e) => e.code === LoroManagerError.ImportPending
      );
      if (pendingOnly) {
        // Loro holds the entry until its causal gap fills, so keep replaying:
        // a later WAL entry may fill the gap, and held ops apply on their own.
        pendingCount += 1;
        continue;
      }
      // Stop replaying. Skipped entries are safe: delivered ones are on the
      // server (server sync will bring them back) and undelivered ones are
      // still in the WAL (next edit or reconnect will flush them).
      logSyncService({
        documentId: 'unknown',
        level: 'error',
        context: { misc: { entryId: entry.id } },
        message: 'snapshot-store: WAL replay failed during cold load',
      });
      break;
    }
  }
  if (pendingCount > 0) {
    logSyncService({
      documentId: 'unknown',
      level: 'warn',
      context: { misc: { pendingCount } },
      message: 'snapshot-store: WAL entries pending during cold load',
    });
  }
  return true;
}
