import type { CollabMarkdownSession } from '@core/collab-surface/types';
import { createLoroManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
} from '@macro-inc/collaboration/collab/snapshot-store';
import type {
  InitialSync,
  LiveSyncSource,
  SyncError,
} from '@macro-inc/collaboration/collab/source';
import {
  BrowserWALStore,
  LORO_WAL_DB_NAME,
} from '@macro-inc/collaboration/collab/wal';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import type { ResultAsync } from 'neverthrow';
import { createSignal, getOwner, runWithOwner } from 'solid-js';

export type ProjectDescriptionTransport = {
  getToken(documentId: string): Promise<string>;
  connect(
    documentId: string,
    token: string
  ): {
    source: LiveSyncSource;
    doInitialSync(): ResultAsync<InitialSync, SyncError>;
  };
};

/** Join the existing backing document; fresh authorization precedes local snapshot reads. */
export function createProjectDescriptionSession(
  documentId: string,
  transport: ProjectDescriptionTransport
): CollabMarkdownSession & { dispose(): void; loaded: Promise<void> } {
  const owner = getOwner();
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, { documentId });
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [connectionError, setConnectionError] = createSignal<string>();
  let disposed = false;
  const loaded = (async () => {
    try {
      const token = await transport.getToken(documentId);
      if (disposed) return;
      const snapshotStore = new IDBSnapshotStore<RawUpdate>(
        LORO_SNAPSHOT_DB_NAME,
        documentId
      );
      const walStore = new BrowserWALStore<RawUpdate>(
        LORO_WAL_DB_NAME,
        documentId
      );
      const local = async () => {
        const snapshot = await snapshotStore.load();
        if (!snapshot || disposed) return;
        const entries = await walStore.getAll();
        if (disposed) return;
        await loroManager.ingest({
          kind: 'local',
          snapshot,
          walUpdates: entries.map((entry) => entry.update),
        });
        if (entries.length && !disposed) {
          const doc = loroManager.doc;
          await snapshotStore.save(
            doc.export({
              mode: 'shallow-snapshot',
              frontiers: doc.oplogFrontiers(),
            })
          );
        }
      };
      // Local cache failures must not prevent a fresh server snapshot.
      void local().catch(() => {});
      const connection = runWithOwner(owner, () =>
        transport.connect(documentId, token)
      );
      if (!connection) throw new Error('Could not start description session.');
      if (disposed) {
        connection.source.cleanup();
        return;
      }
      setSyncSource(connection.source);
      const initial = await connection.doInitialSync();
      if (disposed) return;
      if (initial.isErr())
        throw new Error('Could not load the project description.');
      await loroManager.ingest({
        kind: 'dss',
        snapshot: initial.value.snapshot,
      });
    } catch (error) {
      if (!disposed)
        setConnectionError(
          error instanceof Error
            ? error.message
            : 'Could not load the project description.'
        );
    }
  })();
  return {
    loroManager,
    syncSource,
    connectionError,
    loaded,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      syncSource()?.cleanup();
    },
  };
}
