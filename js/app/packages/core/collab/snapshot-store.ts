import { type DBSchema, type IDBPDatabase, openDB as idbOpen } from 'idb';
import type { LoroManager } from './manager';
import type { GenericRootSchema, RawUpdate } from './shared';
import type { WALStore } from './wal';

export interface SnapshotStore {
  save(snapshot: RawUpdate): Promise<void>;
  load(): Promise<RawUpdate | null>;
  delete(): Promise<void>;
}

const DB_NAME = 'macro-document-snapshots';
const DB_VERSION = 1;
const STORE = 'snapshots';

interface SnapshotSchema extends DBSchema {
  snapshots: {
    key: string;
    value: { documentId: string; snapshot: Uint8Array };
  };
}

export class IDBSnapshotStore implements SnapshotStore {
  private db: Promise<IDBPDatabase<SnapshotSchema>>;

  constructor(private readonly documentId: string) {
    this.db = idbOpen<SnapshotSchema>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        db.createObjectStore(STORE, { keyPath: 'documentId' });
      },
    });
  }

  public async save(snapshot: RawUpdate): Promise<void> {
    const db = await this.db;
    await db.put(STORE, { documentId: this.documentId, snapshot });
  }

  public async load(): Promise<RawUpdate | null> {
    const db = await this.db;
    const row = await db.get(STORE, this.documentId);
    return row?.snapshot ?? null;
  }

  public async delete(): Promise<void> {
    const db = await this.db;
    await db.delete(STORE, this.documentId);
  }
}

/**
 * Bootstrap a Loro doc from cached state: load the last snapshot, then replay
 * any pending WAL entries on top. Returns whether a cached snapshot was
 * applied.
 */
export async function loadCachedState<S extends GenericRootSchema>(
  loroManager: LoroManager<S>,
  snapshotStore: SnapshotStore,
  walStore: WALStore
): Promise<boolean> {
  const snapshot = await snapshotStore.load();
  if (!snapshot) return false;

  const initResult = await loroManager.initializeFromSnapshot(snapshot);
  if (initResult.isErr()) {
    // Stale or corrupt snapshot. We might just keep getting this error, so
    // let's drop it.
    await snapshotStore.delete();
    return false;
  }

  const pending = await walStore.getAll();
  const undelivered = pending.filter((e) => !e.delivered);
  console.log('[WAL] cold load: replaying WAL entries', {
    total: pending.length,
    undelivered: undelivered.length,
  });
  for (const entry of pending) {
    const importResult = loroManager.importUpdate(entry.update);
    if (importResult.isErr()) {
      // Stop replaying. Skipped entries are safe: delivered ones are on the
      // server (server sync will bring them back) and undelivered ones are
      // still in the WAL (next edit or reconnect will flush them).
      console.error('failed to replay WAL entry during cold load', {
        entryId: entry.id,
        err: importResult.error,
      });
      break;
    }
  }
  return true;
}
