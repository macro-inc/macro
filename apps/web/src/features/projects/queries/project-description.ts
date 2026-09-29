import { ingestLocalSnapshot } from '@core/collab-surface/createCollabSurface';
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

export type ProjectDescriptionTransport<Access> = {
  /** Ensure the surface exists and mint connection access for it. */
  authorize(surfaceId: string): Promise<Access>;
  connect(
    surfaceId: string,
    access: Access
  ): {
    source: LiveSyncSource;
    doInitialSync(): ResultAsync<InitialSync, SyncError>;
  };
};

/** Join the project's description surface; fresh authorization precedes local snapshot reads. */
export function createProjectDescriptionSession<Access>(
  surfaceId: string,
  transport: ProjectDescriptionTransport<Access>
): CollabMarkdownSession & { dispose(): void; loaded: Promise<void> } {
  const owner = getOwner();
  const loroManager = createLoroManager(MARKDOWN_LORO_SCHEMA, {
    documentId: surfaceId,
  });
  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [connectionError, setConnectionError] = createSignal<string>();
  let disposed = false;
  const loaded = (async () => {
    try {
      const access = await transport.authorize(surfaceId);
      if (disposed) return;
      // Local cache failures must not prevent a fresh server snapshot.
      void ingestLocalSnapshot(
        loroManager,
        new IDBSnapshotStore<RawUpdate>(LORO_SNAPSHOT_DB_NAME, surfaceId),
        new BrowserWALStore<RawUpdate>(LORO_WAL_DB_NAME, surfaceId)
      ).catch(() => {});
      const connection = runWithOwner(owner, () =>
        transport.connect(surfaceId, access)
      );
      if (!connection) throw new Error('Could not start description session.');
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
