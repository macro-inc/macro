import { ingestLocalSnapshot } from '@core/collab-surface/createCollabSurface';
import type { CollabMarkdownSession } from '@core/collab-surface/types';
import { createAutomergeManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import {
  AUTOMERGE_SNAPSHOT_DB_NAME,
  IDBSnapshotStore,
} from '@macro-inc/collaboration/collab/snapshot-store';
import type {
  InitialSync,
  LiveSyncSource,
  SyncError,
} from '@macro-inc/collaboration/collab/source';
import {
  AUTOMERGE_WAL_DB_NAME,
  BrowserWALStore,
} from '@macro-inc/collaboration/collab/wal';
import { MARKDOWN_AUTOMERGE_SCHEMA } from '@macro-inc/lexical-core/markdown-automerge-schema';
import type { ResultAsync } from 'neverthrow';
import { createSignal, getOwner, runWithOwner } from 'solid-js';

export type ProjectDescriptionTransport<Access> = {
  authorize(documentId: string): Promise<Access>;
  connect(
    documentId: string,
    access: Access
  ): {
    source: LiveSyncSource;
    doInitialSync(): ResultAsync<InitialSync, SyncError>;
  };
};

/** Join the existing backing document; fresh authorization precedes local snapshot reads. */
export function createProjectDescriptionSession<Access>(
  documentId: string,
  transport: ProjectDescriptionTransport<Access>
): CollabMarkdownSession & { dispose(): void; loaded: Promise<void> } {
  const owner = getOwner();
  const automergeManager = createAutomergeManager(MARKDOWN_AUTOMERGE_SCHEMA, {
    documentId,
  });
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [connectionError, setConnectionError] = createSignal<string>();
  let disposed = false;
  const loaded = (async () => {
    try {
      const access = await transport.authorize(documentId);
      if (disposed) return;
      // Local cache failures must not prevent a fresh server snapshot.
      void ingestLocalSnapshot(
        automergeManager,
        new IDBSnapshotStore<RawUpdate>(AUTOMERGE_SNAPSHOT_DB_NAME, documentId),
        new BrowserWALStore<RawUpdate>(AUTOMERGE_WAL_DB_NAME, documentId)
      ).catch(() => {});
      const connection = runWithOwner(owner, () =>
        transport.connect(documentId, access)
      );
      if (!connection) throw new Error('Could not start description session.');
      setSyncSource(connection.source);
      const initial = await connection.doInitialSync();
      if (disposed) return;
      if (initial.isErr())
        throw new Error('Could not load the project description.');
      await automergeManager.ingest({
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
    automergeManager,
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
