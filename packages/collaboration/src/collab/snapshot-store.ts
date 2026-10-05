import {
  IDBSnapshotStore,
  type SnapshotStore,
} from '@macro-inc/browser-store/snapshot-store';
import type { WALStore } from '@macro-inc/browser-store/wal-store';
import { documentStoreLogger, logSyncService } from './logger';
import { type LoroManager, LoroManagerError } from './manager';
import type { GenericRootSchema, RawUpdate } from './shared';

/** DB name for the Loro doc-snapshot store. */
export const LORO_SNAPSHOT_DB_NAME = 'macro-document-snapshots';

/** The durable snapshot of one document's Loro doc. */
export function createDocumentSnapshotStore(
  documentId: string
): SnapshotStore<RawUpdate> {
  return new IDBSnapshotStore<RawUpdate>(
    LORO_SNAPSHOT_DB_NAME,
    documentId,
    documentStoreLogger(documentId)
  );
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
