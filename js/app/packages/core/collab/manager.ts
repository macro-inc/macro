import type { ResultError } from '@core/util/result';

import {
  type InferType,
  Mirror,
  SyncDirection,
  type UpdateMetadata,
} from '@loro-mirror/packages/core/src';
import {
  type Container,
  type ContainerID,
  type Cursor,
  LoroDoc,
  type PeerID,
  type Side,
  type VersionVector,
} from 'loro-crdt';
import { err, ok, type Result } from 'neverthrow';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';
import { logSyncService } from './logger';
import type { GenericRootSchema, LoroRawUpdate, RawUpdate } from './shared';
import type { LiveSyncSource } from './source';

export enum LoroManagerError {
  ImportFailed = 'IMPORT_FAILED',
  NotInitialized = 'NOT_INITIALIZED',
  InitializeFailed = 'INITIALIZE_FAILED',
  SyncFailed = 'SYNC_FAILED',
  ExportFailed = 'EXPORT_FAILED',
  GetCursorPosFailed = 'GET_CURSOR_POS_FAILED',
  GetContainerByIdFailed = 'GET_CONTAINER_BY_ID_FAILED',
  UnknownLoroError = 'UNKNOWN_LORO_ERROR',
}

export enum LoroStateTag {
  Initialize = 'INITIALIZE',
  FromManager = 'FROM_MANAGER',
}

/**
 * The LoroManager is responsible for managing the state of the LoroDoc
 * It does this by syncing arbitrary json state to and from the LoroDoc
 * via the Mirror. The mirror will incrementally diff the incoming json state
 * and correctly apply it to the LoroDoc.
 *
 * ┌────────────┬──────────────────────────────────────┐
 * │  Manager   │                                      │
 * ├────────────┘                                      │
 * │                                                   │
 * │                    .───────.                      │
 * │                   ╱         ╲                     │
 * │                  (   State   )◀─┐                 │
 * │                   `.       ,'   │                 │
 * │                     │─────'     │                 │
 * │        ┌───┬────────┴───────────┘                 │
 * │        │   │                                      │
 * │        │   ▼                                      │
 * │    ┌──────────────┐          ┌──────────────┐     │
 * │    │              │          │              │     │
 * │    │              │◀─────────┤              │     │
 * │    │    Mirror    │          │   LoroDoc    │     │
 * │    │              ├─────────▶│              │     │
 * │    │              │          │              │     │
 * │    └──────────────┘          └──────────────┘     │
 * │                                                   │
 * │                                                   │
 * └───────────────────────────────────────────────────┘
 */
export type LoroManager<S extends GenericRootSchema = GenericRootSchema> = {
  /**
   * Accessor to the inner LoroDoc
   * Only use this if you know what you're doing
   * Most operations should be done through the manager directly
   *
   * @returns The LoroDoc
   **/
  getDoc: Accessor<LoroDoc>;

  /**
   * Accessor to the inner Mirror
   * Only use this if you know what you're doing
   * Most operations should be done through the manager directly
   *
   * @returns The Mirror
   **/
  getMirror: Accessor<Mirror<S> | undefined>;

  /** The current schema of the manager */
  schema: S;

  /** The current mirrored state of the loro doc
   *
   * ┌─────────────┐
   * │ Local State │                    ┌─────────────┐
   * │   Update    │                    │Remote Import│
   * └─────────────┘                    └─────────────┘
   *       │                                  │
   *       │                                  │
   *       ▼                                  ▼
   * ┌──────────┐      ┌ ─ ─ ─ ─ ┐      ┌──────────┐      ┌ ─ ─ ─ ─ ─ ┐
   * │  Mirror  │─────▶   Diff          │ LoroDoc  │─────▶ exportJSON
   * └──────────┘      └ ─ ─ ─ ─ ┘      └──────────┘      └ ─ ─ ─ ─ ─ ┘
   *                         │                                   │
   *                         │                                   │
   *                         ▼                                   ▼
   *                   ┌───────────┐                       ┌───────────┐
   *                   │  LoroDoc  │                       │   State   │
   *                   └───────────┘                       └───────────┘
   * */
  state: Accessor<StateUpdate<S> | undefined>;

  /* Signal containing the errors */
  error: Accessor<LoroManagerError[]>;

  /** Signal containing the initialized state of the manager */
  isInitialized: Accessor<boolean>;

  /** Syncs the infered state from the schema to the loro doc via the Mirror
   *
   *
   * ┌─────────────┐
   * │ Local State │
   * │   Update    │
   * └─────────────┘
   *       │
   *       │
   *       ▼
   * ┌──────────┐      ┌ ─ ─ ─ ─ ┐
   * │  Mirror  │─────▶   Diff
   * └──────────┘      └ ─ ─ ─ ─ ┘
   *                         │
   *                         │
   *                         ▼
   *                   ┌───────────┐
   *                   │  LoroDoc  │
   *                   └───────────┘
   *
   * @param state - The state to sync to loro
   * @returns result - The error if syncing to loro failed
   *
   * */
  syncToLoro(
    state: InferType<S>
  ): Promise<Result<void, ResultError<LoroManagerError>[]>>;

  /** Retrieve all loro container ids */
  getAllContainerIds(): Result<ContainerID[], ResultError<LoroManagerError>[]>;

  /**  Retrieve a LoroUpdate with all relavent events/data since the given version vector
   *
   * @param lastVersionVector - The last version vector to sync from
   * @returns result - The update if it exists, or an error if it doesn't
   * */
  getUpdateSince(
    lastVersionVector: VersionVector
  ): Result<Uint8Array | undefined, ResultError<LoroManagerError>[]>;

  /** Initializes the manager from a snapshot
   *
   * If this is successful, it will set isInitialized to true
   *
   * @param snapshot - The snapshot to initialize from
   * @returns result - The error if initializing from the snapshot failed
   * */
  initializeFromSnapshot(
    snapshot: LoroRawUpdate
  ): Promise<Result<void, ResultError<LoroManagerError>[]>>;

  /** Imports a single loro update
   *
   * @param update - The update to import
   * @returns result - The error if importing the update failed
   * */
  importUpdate(
    update: LoroRawUpdate
  ): Result<boolean, ResultError<LoroManagerError>[]>;

  /** Imports multiple loro updates at once
   *
   * @param updates - The updates to import
   * @returns result - The error if importing the updates failed
   * */
  importBatchUpdates(
    updates: LoroRawUpdate[]
  ): Result<boolean, ResultError<LoroManagerError>[]>;

  /** Resets the manager to a new state
   *
   * @param snapshot - The snapshot to reset to
   * @returns result - The error if resetting the manager failed
   * */
  reset(
    snapshot: LoroRawUpdate
  ): Promise<Result<void, ResultError<LoroManagerError>[]>>;

  /** Returns the current version of the manager */
  getVersion(): VersionVector;

  /** Returns the current state of the manager */
  getPeerId(): bigint;

  getPeerIdStr(): PeerID;

  /** Returns the container with the given id if it exists */
  getContainerById(
    id: ContainerID
  ): Result<Container | undefined, ResultError<LoroManagerError>[]>;

  /** Feed a snapshot from any source. The init state machine internally
   *  decides whether to apply, ignore, or chain a `requestUpdatesSince`
   *  follow-up against the live sync source. */
  ingest(input: SnapshotIngest): Promise<void>;

  /** Returns the current cursor position for the given LoroCursor within its container */
  getCursorPos(cursor: Cursor): Result<
    {
      update?: Cursor;
      offset: number;
      side: Side;
    },
    ResultError<LoroManagerError>[]
  >;
};

export type StateUpdate<S extends GenericRootSchema> = {
  state: InferType<S>;
  metadata: UpdateMetadata;
};

export type SnapshotIngest =
  | { kind: 'optimistic'; snapshot: RawUpdate }
  | {
      kind: 'local';
      snapshot: RawUpdate;
      /** Optional WAL update entries to replay on top of the snapshot. */
      walUpdates?: RawUpdate[];
    }
  | { kind: 's3'; snapshot: RawUpdate }
  | { kind: 'dss'; snapshot: RawUpdate };

export type LoroManagerOptions = {
  /** Accessor returning the live sync source. Required because ingest converges
   *  to server truth via `requestUpdatesSince` after seeding. */
  liveSyncSource: () => LiveSyncSource;
  documentId: string;
};

/** Creates a new [LoroManager] instance
 *
 * @param schema - The schema to use for the manager
 * @param options - Optional dependencies (e.g. live sync source for catch-up)
 * @returns The new manager [LoroManager]
 * */
export function createLoroManager<S extends GenericRootSchema>(
  schema: S,
  options: LoroManagerOptions
): LoroManager<S> {
  const [initialized, setInitialized] = createSignal<boolean>(false);
  const [loroDoc, setLoroDoc] = createSignal<LoroDoc>(createLoroDoc());
  const [mirror, setMirror] = createSignal<Mirror<S>>();
  const [error, setError] = createSignal<LoroManagerError[]>([]);
  const [state, setState] = createSignal<StateUpdate<S>>();

  const { documentId } = options;
  /**
   * True once the doc has been seeded from any snapshot.
   * We ignore any subsequent snapshots provided after.
   */
  let seeded = false;
  const docJson = (): unknown => {
    try {
      return loroDoc().toJSON();
    } catch (e) {
      return `<toJSON failed: ${e}>`;
    }
  };
  logSyncService({
    documentId,
    level: 'debug',
    context: {},
    message: 'manager: created',
  });

  /** Util for awaiting the sync of the mirror to finish */
  const awaitMirrorSync = async () => {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  };

  const pushError = (error: LoroManagerError) => {
    setError((prev) => [...prev, error]);
  };

  const importUpdate = (
    update: LoroRawUpdate
  ): Result<boolean, ResultError<LoroManagerError>[]> => {
    let importStatus;

    try {
      importStatus = loroDoc().import(update);
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `importUpdate failed: ${e}`,
      });
      pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: `Failed to import update: ${e}`,
        },
      ]);
    }

    const didChange = Object.keys(importStatus.success).length > 0;

    if (Object.keys(importStatus.pending ?? {}).length > 0) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: 'importUpdate: pending updates after import',
      });
      pushError(LoroManagerError.ImportFailed);
      return err([
        { code: LoroManagerError.ImportFailed, message: 'Import failed' },
      ]);
    }

    logSyncService({
      documentId: documentId,
      level: 'info',
      context: { misc: { loroSuccess: importStatus.success, doc: docJson() } },
      message: `importUpdate: ok (didChange=${didChange})`,
    });
    return ok(didChange);
  };

  const importBatchUpdates = (
    updates: LoroRawUpdate[]
  ): Result<boolean, ResultError<LoroManagerError>[]> => {
    let importStatus;

    try {
      importStatus = loroDoc().importBatch(updates);
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `importBatchUpdates failed: ${e}`,
      });
      pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: `Failed to import update: ${e}`,
        },
      ]);
    }

    const didChange = Object.keys(importStatus.success).length > 0;

    if (Object.keys(importStatus.pending ?? {}).length > 0) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: 'importBatchUpdates: pending updates after import',
      });
      pushError(LoroManagerError.ImportFailed);
      return err([
        { code: LoroManagerError.ImportFailed, message: 'Import failed' },
      ]);
    }

    logSyncService({
      documentId: documentId,
      level: 'info',
      context: { misc: { loroSuccess: importStatus.success } },
      message: `importBatchUpdates: ok (${updates.length} updates, didChange=${didChange})`,
    });
    return ok(didChange);
  };

  const initializeFromSnapshot = async (
    snapshot: LoroRawUpdate
  ): Promise<Result<void, ResultError<LoroManagerError>[]>> => {
    const importResult = importUpdate(snapshot);

    if (importResult.isErr()) {
      const [error] = importResult.error;
      return err([{ code: error.code, message: error.message }]);
    }

    const mirror_ = createMirror(loroDoc(), schema);

    try {
      await awaitMirrorSync();
      const mirrorState = mirror_.getState();
      setState(() => ({
        state: mirrorState,
        metadata: {
          direction: SyncDirection.TO_LORO,
          tags: ['INITIALIZE'],
        },
      }));
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `initializeFromSnapshot: mirror sync failed: ${e}`,
      });
      pushError(LoroManagerError.InitializeFailed);
      return err([
        {
          code: LoroManagerError.InitializeFailed,
          message: `Failed to sync mirror: ${e}`,
        },
      ]);
    }

    setInitialized(true);
    setMirror(mirror_);

    logSyncService({
      documentId: documentId,
      level: 'info',
      context: { misc: { doc: docJson() } },
      message: 'initializeFromSnapshot: ok, manager initialized',
    });
    return ok(undefined);
  };

  const getUpdateSince = (
    lastVersionVector: VersionVector
  ): Result<Uint8Array | undefined, ResultError<LoroManagerError>[]> => {
    const mirror_ = mirror();

    if (!initialized() || !mirror_) {
      return err([
        { code: LoroManagerError.NotInitialized, message: 'Not initialized' },
      ]);
    }
    const currentVersionVector = loroDoc().version();
    /** Comparison between the current state, and the last synced state */
    const vvDiff = lastVersionVector.compare(currentVersionVector);

    if (vvDiff === 0) {
      return ok(undefined);
    }

    const spans = loroDoc().findIdSpansBetween(
      loroDoc().vvToFrontiers(lastVersionVector),
      loroDoc().vvToFrontiers(currentVersionVector)
    );

    const localSpans = spans.forward.filter(
      (span) => span.peer === loroDoc().peerIdStr
    );

    let update;

    try {
      update = loroDoc().export({
        mode: 'updates-in-range',
        spans: localSpans.map((span) => ({
          id: { peer: span.peer, counter: span.counter },
          len: span.length,
        })),
      });
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `getUpdateSince: export failed: ${e}`,
      });
      pushError(LoroManagerError.ExportFailed);
      return err([
        {
          code: LoroManagerError.ExportFailed,
          message: `Failed to export update: ${e}`,
        },
      ]);
    }

    return ok(update);
  };

  const getAllContainerIds = (): Result<
    ContainerID[],
    ResultError<LoroManagerError>[]
  > => {
    if (!initialized() || !mirror()) {
      return err([
        { code: LoroManagerError.NotInitialized, message: 'Not initialized' },
      ]);
    }

    return ok(mirror()!.getContainerIds());
  };

  const syncToLoro = async (
    state: InferType<S>
  ): Promise<Result<void, ResultError<LoroManagerError>[]>> => {
    const mirror_ = mirror();
    if (!initialized() || !mirror_) {
      return err([
        { code: LoroManagerError.NotInitialized, message: 'Not initialized' },
      ]);
    }

    try {
      mirror_.setState(state, {
        tags: LoroStateTag.FromManager,
      });

      await awaitMirrorSync();
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `syncToLoro failed: ${e}`,
      });
      return err([
        {
          code: LoroManagerError.SyncFailed,
          message: `Failed to sync to loro: ${e}`,
        },
      ]);
    }

    logSyncService({
      documentId: documentId,
      level: 'debug',
      context: {},
      message: 'syncToLoro: ok',
    });
    return ok(undefined);
  };

  const reset = async (
    snapshot: LoroRawUpdate
  ): Promise<Result<void, ResultError<LoroManagerError>[]>> => {
    mirror()?.dispose();
    loroDoc().free();

    const newDoc = createLoroDoc();
    setLoroDoc(newDoc);

    let importStatus;
    try {
      importStatus = newDoc.import(snapshot);
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `reset: snapshot import failed: ${e}`,
      });
      pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: `Failed to import snapshot: ${e}`,
        },
      ]);
    }

    if (Object.keys(importStatus.pending ?? {}).length > 0) {
      pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: 'Snapshot import has pending updates',
        },
      ]);
    }

    const newMirror = createMirror(newDoc, schema);
    setMirror(newMirror);

    await awaitMirrorSync();

    const state = newMirror.getState();
    setState({
      state,
      metadata: {
        direction: SyncDirection.TO_LORO,
        tags: [LoroStateTag.Initialize],
      },
    });

    setInitialized(true);

    logSyncService({
      documentId: documentId,
      level: 'info',
      context: { misc: { loroSuccess: importStatus.success } },
      message: 'reset: ok, manager re-initialized',
    });
    return ok(undefined);
  };

  const getContainerById = (
    id: ContainerID
  ): Result<Container | undefined, ResultError<LoroManagerError>[]> => {
    let container: Container | undefined;

    try {
      container = loroDoc().getContainerById(id);
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `getContainerById failed: ${e}`,
      });
      pushError(LoroManagerError.GetContainerByIdFailed);
      return err([
        { code: LoroManagerError.GetContainerByIdFailed, message: e },
      ]);
    }

    return ok(container);
  };

  const getCursorPos = (
    cursor: Cursor
  ): Result<
    {
      update?: Cursor;
      offset: number;
      side: Side;
    },
    ResultError<LoroManagerError>[]
  > => {
    let pos: { update?: Cursor; offset: number; side: Side } | undefined;
    try {
      pos = loroDoc().getCursorPos(cursor);
      if (!pos) {
        return err([
          {
            code: LoroManagerError.GetCursorPosFailed,
            message: "loro didn't give us a cursor position",
          },
        ]);
      }
    } catch (e) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `getCursorPos failed: ${e}`,
      });
      pushError(LoroManagerError.GetCursorPosFailed);
      return err([{ code: LoroManagerError.GetCursorPosFailed, message: e }]);
    }

    return ok(pos);
  };

  createEffect(() => {
    if (mirror()) {
      mirror()?.subscribe((update, metadata) => {
        setState(() => ({
          state: update,
          metadata,
        }));
      });
    }
  });

  onCleanup(() => {
    mirror()?.dispose();
    loroDoc().free();
  });

  /** Apply a snapshot to the loro doc — initialize on first touch, otherwise
   *  merge as an update. Errors are logged and surfaced via the return. */
  const applySnapshot = async (
    snapshot: RawUpdate,
    context: string
  ): Promise<boolean> => {
    if (!initialized()) {
      const initResult = await initializeFromSnapshot(snapshot);
      if (initResult.isErr()) {
        logSyncService({
          documentId: documentId,
          level: 'error',
          context: {},
          message: `applySnapshot(${context}): initializeFromSnapshot failed`,
        });
        return false;
      }
      return true;
    }
    const importResult = importUpdate(snapshot);
    if (importResult.isErr()) {
      logSyncService({
        documentId: documentId,
        level: 'error',
        context: {},
        message: `applySnapshot(${context}): importUpdate failed`,
      });
      return false;
    }
    return true;
  };

  /**
   * Pull every server op since our current version and merge it in.
   **/
  const convergeFromServer = async (): Promise<void> => {
    const deltaResult = await options
      .liveSyncSource()
      .requestUpdatesSince(loroDoc().version());
    if (deltaResult.isErr()) {
      logSyncService({
        documentId,
        level: 'warn',
        context: {},
        message: 'converge: requestUpdatesSince failed',
      });
      return;
    }
    const deltaImport = importUpdate(deltaResult.value);
    if (deltaImport.isErr()) {
      logSyncService({
        documentId,
        level: 'error',
        context: {},
        message: 'converge: failed to apply server delta',
      });
      return;
    }
    logSyncService({
      documentId,
      level: 'info',
      context: { misc: { doc: docJson() } },
      message: 'converge: applied server delta',
    });
  };

  /**
   * Feed a snapshot from any source. The first snapshot to arrive seeds the
   * (empty) doc; later snapshots are ignored because loro can't merge a snapshot
   * onto a non-empty doc. After seeding we converge to server truth via
   * `requestUpdatesSince`. Offline edits carried as `walUpdates` are replayed as
   * updates (those *do* merge), regardless of seed order.
   */
  const ingest = async (input: SnapshotIngest): Promise<void> => {
    if (seeded) {
      // Already seeded — a second snapshot can't merge. The only thing worth
      // taking from a later `local` is its WAL updates (real ops → mergeable).
      if (input.kind === 'local' && input.walUpdates?.length) {
        const replayResult = importBatchUpdates(input.walUpdates);
        if (replayResult.isErr()) {
          logSyncService({
            documentId,
            level: 'error',
            context: {},
            message: `ingest(${input.kind}): WAL replay failed`,
          });
        }
      } else {
        logSyncService({
          documentId,
          level: 'debug',
          context: {},
          message: `ingest(${input.kind}): ignored (already seeded)`,
        });
      }
      return;
    }

    const applied = await applySnapshot(input.snapshot, input.kind);
    if (!applied) return;
    seeded = true;
    logSyncService({
      documentId,
      level: 'info',
      context: { misc: { doc: docJson() } },
      message: `ingest: seeded from ${input.kind}`,
    });

    if (input.kind === 'local' && input.walUpdates?.length) {
      const replayResult = importBatchUpdates(input.walUpdates);
      if (replayResult.isErr()) {
        logSyncService({
          documentId,
          level: 'error',
          context: {},
          message: `ingest(${input.kind}): WAL replay failed`,
        });
      }
    }

    // dss is already server truth so no reason to request updates in that case
    if (input.kind !== 'dss') await convergeFromServer();
  };

  return {
    getDoc: loroDoc,
    getMirror: mirror,
    schema,
    state,
    error,
    isInitialized: initialized,
    getAllContainerIds,
    getUpdateSince,
    initializeFromSnapshot,
    importUpdate,
    importBatchUpdates,
    syncToLoro,
    reset,
    ingest,
    getVersion: () => loroDoc().version(),
    getPeerId: () => loroDoc().peerId,
    getPeerIdStr: () => loroDoc().peerIdStr,
    getContainerById,
    getCursorPos,
  };
}

export function createLoroDoc(): LoroDoc {
  const doc = new LoroDoc();
  doc.setRecordTimestamp(true);
  return doc;
}

function createMirror<S extends GenericRootSchema>(
  doc: LoroDoc,
  schema: S
): Mirror<S> {
  return new Mirror({
    doc,
    schema,
  });
}
