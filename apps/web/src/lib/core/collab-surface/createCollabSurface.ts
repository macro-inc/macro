import type { AutomergeManager } from '@macro-inc/collaboration/collab/manager';
import { createAutomergeManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import {
  AUTOMERGE_SNAPSHOT_DB_NAME,
  IDBSnapshotStore,
} from '@macro-inc/collaboration/collab/snapshot-store';
import type { LiveSyncSource } from '@macro-inc/collaboration/collab/source';
import {
  AUTOMERGE_WAL_DB_NAME,
  BrowserWALStore,
} from '@macro-inc/collaboration/collab/wal';
import { MARKDOWN_AUTOMERGE_SCHEMA } from '@macro-inc/lexical-core/markdown-automerge-schema';
import { storageServiceClient } from '@service-storage/client';
import type { CollabSurfaceResponse } from '@service-storage/service';
import { createCollabSurfaceSource } from '@service-sync/source';
import { type Accessor, createSignal } from 'solid-js';
import { getCollabSurfaceToken } from './token';

export type CollabSurfaceAutomergeManager = AutomergeManager<
  typeof MARKDOWN_AUTOMERGE_SCHEMA
>;

/** The parent entity a surface hangs off; all access derives from it. */
export type CollabSurfaceParent = {
  entityType: CollabSurfaceResponse['parentEntityType'];
  entityId: string;
};

export type CollabSurfaceSessionOptions = {
  /**
   * The surface's parent entity. The session idempotently ensures the surface
   * exists (load-or-create) before connecting, so a caller only needs a
   * stable id and the parent — no separate creation step.
   */
  parent: CollabSurfaceParent;
  /**
   * Markdown to seed the surface with if this ensure creates it. Ignored when
   * the surface already exists.
   */
  initialMarkdown?: string;
  /**
   * Snapshot to seed the editor with while waiting for local/remote state.
   * Loses the seed race gracefully if local or remote state lands first.
   */
  optimisticSnapshot?: Uint8Array;
};

export type CollabSurfaceSession = {
  surfaceId: string;
  automergeManager: CollabSurfaceAutomergeManager;
  /**
   * The live sync source. Undefined until the initial connection token is
   * minted and the socket created — gate the collab provider on it.
   */
  syncSource: Accessor<LiveSyncSource | undefined>;
  /** Set when the session could not connect (e.g. token minting failed). */
  connectionError: Accessor<string | undefined>;
  /** Close the websocket. Call from `onCleanup`. */
  dispose: () => void;
};

/**
 * Ingest the local IDB snapshot plus any buffered WAL edits. Mirrors the md
 * block's local ingest (`Block.tsx`), including folding replayed WAL entries
 * into a fresh snapshot so a reload during recovery doesn't show stale state.
 */
export async function ingestLocalSnapshot(
  automergeManager: CollabSurfaceAutomergeManager,
  snapshotStore: IDBSnapshotStore<RawUpdate>,
  walStore: BrowserWALStore<RawUpdate>
): Promise<void> {
  const localSnapshot = await snapshotStore.load();
  if (!localSnapshot) return;
  const walEntries = await walStore.getAll();
  await automergeManager.ingest({
    kind: 'local',
    snapshot: localSnapshot,
    walUpdates: walEntries.map((entry) => entry.update),
  });

  if (walEntries.length >= 1) {
    const doc = automergeManager.doc;
    const snapshot = doc.export({
      mode: 'shallow-snapshot',
      frontiers: doc.oplogFrontiers(),
    });
    await snapshotStore.save(snapshot);
  }
}

/**
 * A live collaboration session for an arbitrary markdown surface,
 * load-or-create: give it a stable surface id plus its parent entity, and it
 * idempotently ensures the surface exists before connecting.
 *
 * Creates the Automerge manager and local stores synchronously (so cached state can
 * seed the editor before the network round-trips), then ensures the surface,
 * mints a connection token, and opens the sync-service websocket. Three
 * snapshot sources race to seed the manager — optimistic (if provided), local
 * IDB+WAL, and the remote initial sync — and the manager ignores all but the
 * first.
 *
 * No S3 cached-snapshot ingest: `fetchCachedSnapshot` is a documents-only
 * route today. Add a fourth race entry here if surfaces grow a backend
 * snapshot cache.
 */
export function createCollabSurfaceSession(
  surfaceId: string,
  opts: CollabSurfaceSessionOptions
): CollabSurfaceSession {
  const automergeManager = createAutomergeManager(MARKDOWN_AUTOMERGE_SCHEMA, {
    documentId: surfaceId,
  });
  const snapshotStore = new IDBSnapshotStore<RawUpdate>(
    AUTOMERGE_SNAPSHOT_DB_NAME,
    surfaceId
  );
  const walStore = new BrowserWALStore<RawUpdate>(
    AUTOMERGE_WAL_DB_NAME,
    surfaceId
  );

  const [syncSource, setSyncSource] = createSignal<LiveSyncSource>();
  const [connectionError, setConnectionError] = createSignal<string>();
  let disposed = false;

  const optimisticSnapshot = opts.optimisticSnapshot;
  if (optimisticSnapshot) {
    void automergeManager
      .ingest({ kind: 'optimistic', snapshot: optimisticSnapshot })
      .catch((error) => {
        console.error('collab surface: optimistic ingest failed', error);
      });
  }

  void ingestLocalSnapshot(automergeManager, snapshotStore, walStore).catch(
    (error) => {
      console.error('collab surface: local snapshot ingest failed', error);
    }
  );

  void (async () => {
    // Load-or-create. Idempotent on the backend, so mounting the same
    // surface in several places (or racing another client) is fine.
    const ensured = await storageServiceClient.collabSurfaces.ensure({
      id: surfaceId,
      parentEntityType: opts.parent.entityType,
      parentEntityId: opts.parent.entityId,
      initialMarkdown: opts.initialMarkdown,
    });
    if (disposed) return;
    if (ensured.isErr()) {
      console.error('collab surface: ensure failed', ensured.error);
      setConnectionError('failed to load or create the surface');
      return;
    }

    const token = await getCollabSurfaceToken(surfaceId);
    if (disposed) return;
    if (!token) {
      setConnectionError('failed to mint a sync connection token');
      return;
    }

    const { source, doInitialSync } = createCollabSurfaceSource(
      surfaceId,
      token,
      () => getCollabSurfaceToken(surfaceId)
    );
    if (disposed) {
      source.cleanup();
      return;
    }
    setSyncSource(source);

    const sync = await doInitialSync();
    if (sync.isErr()) {
      console.error(
        'collab surface: failed to receive initial sync',
        sync.error
      );
      return;
    }
    await automergeManager.ingest({
      kind: 'dss',
      snapshot: sync.value.snapshot,
    });
  })();

  return {
    surfaceId,
    automergeManager,
    syncSource,
    connectionError,
    dispose: () => {
      disposed = true;
      syncSource()?.cleanup();
    },
  };
}
