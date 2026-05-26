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
import type { GenericRootSchema, LoroRawUpdate } from './shared';

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

/** Creates a new [LoroManager] instance
 *
 * @param schema - The schema to use for the manager
 * @returns The new manager [LoroManager]
 * */
export function createLoroManager<S extends GenericRootSchema>(
  schema: S
): LoroManager<S> {
  const [initialized, setInitialized] = createSignal<boolean>(false);
  const [loroDoc, setLoroDoc] = createSignal<LoroDoc>(createLoroDoc());
  const [mirror, setMirror] = createSignal<Mirror<S>>();
  const [error, setError] = createSignal<LoroManagerError[]>([]);
  const [state, setState] = createSignal<StateUpdate<S>>();

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
      console.error('Failed to import update', e);
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
      pushError(LoroManagerError.ImportFailed);
      return err([
        { code: LoroManagerError.ImportFailed, message: 'Import failed' },
      ]);
    }

    return ok(didChange);
  };

  const importBatchUpdates = (
    updates: LoroRawUpdate[]
  ): Result<boolean, ResultError<LoroManagerError>[]> => {
    let importStatus;

    try {
      importStatus = loroDoc().importBatch(updates);
    } catch (e) {
      console.error('Failed to import update', e);
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
      pushError(LoroManagerError.ImportFailed);
      return err([
        { code: LoroManagerError.ImportFailed, message: 'Import failed' },
      ]);
    }

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
      console.error('Failed to sync mirror', e);
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
      console.error('Failed to export update', e);
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
      console.error('Failed to sync to loro', e);
      return err([
        {
          code: LoroManagerError.SyncFailed,
          message: `Failed to sync to loro: ${e}`,
        },
      ]);
    }

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
      console.error('Failed to import snapshot', e);
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

    return ok(undefined);
  };

  const getContainerById = (
    id: ContainerID
  ): Result<Container | undefined, ResultError<LoroManagerError>[]> => {
    let container: Container | undefined;

    try {
      container = loroDoc().getContainerById(id);
    } catch (e) {
      console.error('Failed to get container', e);
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
    } catch (e) {
      console.error('Failed to get cursor pos', e);
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
