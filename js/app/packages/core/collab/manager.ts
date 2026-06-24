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
  ImportStatus,
} from 'loro-crdt';
import { err, ok, type Result } from 'neverthrow';
import { onCleanup } from 'solid-js';
import { logSyncService } from './logger';
import type { GenericRootSchema, LoroRawUpdate, RawUpdate } from './shared';

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
  documentId: string;
};

/**
 * The slice of {@link LoroManager} that {@link SyncEngine} depends on. This lean
 * interface is the DI seam: it lets the engine be unit-tested against a mock
 * (which can't satisfy the concrete class's `private` fields), while the real
 * `LoroManager` and any future stub both fit it structurally.
 */
export interface SyncEngineManager<
  S extends GenericRootSchema = GenericRootSchema,
> {
  readonly doc: LoroDoc;
  readonly initialized: boolean;
  readonly peerId: bigint;
  importUpdate(
    update: LoroRawUpdate
  ): Result<boolean, ResultError<LoroManagerError>[]>;
  syncToLoro(
    state: InferType<S>
  ): Promise<Result<void, ResultError<LoroManagerError>[]>>;
  reset(
    snapshot: LoroRawUpdate
  ): Promise<Result<void, ResultError<LoroManagerError>[]>>;
  /** Subscribe to state changes; `createSyncEngine` uses this to wire the
   *  manager's updates into the engine. Returns an unsubscribe fn. */
  onStateChange(listener: (update: StateUpdate<S>) => void): () => void;
}

/**
 * The LoroManager manages the state of a LoroDoc by syncing arbitrary JSON
 * state to and from it via the {@link Mirror}, which incrementally diffs the
 * incoming JSON state and applies it to the LoroDoc.
 *
 * ┌────────────┬──────────────────────────────────────┐
 * │  Manager   │                                      │
 * ├────────────┘                                      │
 * │                    .───────.                      │
 * │                   ╱         ╲                     │
 * │                  (   State   )◀─┐                 │
 * │                   `.       ,'   │                 │
 * │                     │─────'     │                 │
 * │        ┌───┬────────┴───────────┘                 │
 * │        │   ▼                                      │
 * │    ┌──────────────┐          ┌──────────────┐     │
 * │    │              │◀─────────┤              │     │
 * │    │    Mirror    │          │   LoroDoc    │     │
 * │    │              ├─────────▶│              │     │
 * │    └──────────────┘          └──────────────┘     │
 * └───────────────────────────────────────────────────┘
 *
 * This is a pure, Solid-free class: reads are plain getters and changes are
 * announced through the `onStateChange` / `onInitializedChange` subscriptions
 * (the same callback shape `SyncEngine` uses for `onRunningChange`). The browser
 * wraps it with {@link createLoroManager} to bridge those into signals; headless
 * callers (the AI worker) construct and subscribe to it directly.
 */
export class LoroManager<S extends GenericRootSchema = GenericRootSchema>
  implements SyncEngineManager<S>
{
  /** The current schema of the manager. */
  readonly schema: S;

  private _initialized = false;
  private _doc: LoroDoc = createLoroDoc();
  private _mirror?: Mirror<S>;
  private _errors: LoroManagerError[] = [];
  private _state?: StateUpdate<S>;

  private mirrorUnsub?: () => void;
  private readonly options: LoroManagerOptions;

  private readonly stateListeners = new Set<(u: StateUpdate<S>) => void>();
  private readonly initListeners = new Set<(v: boolean) => void>();

  constructor(schema: S, options: LoroManagerOptions) {
    this.schema = schema;
    this.options = options;
  }

  /** The inner LoroDoc. Only touch this if you know what you're doing. */
  get doc(): LoroDoc {
    return this._doc;
  }
  /** The inner Mirror, once initialized. */
  get mirror(): Mirror<S> | undefined {
    return this._mirror;
  }
  /** The latest mirrored state + the metadata of the update that produced it. */
  get state(): StateUpdate<S> | undefined {
    return this._state;
  }
  /** Errors accumulated over this manager's life. */
  get errors(): LoroManagerError[] {
    return this._errors;
  }
  /** Whether the manager has been initialized from a snapshot. */
  get initialized(): boolean {
    return this._initialized;
  }
  get peerId(): bigint {
    return this._doc.peerId;
  }
  get peerIdStr(): PeerID {
    return this._doc.peerIdStr;
  }
  get version(): VersionVector {
    return this._doc.version();
  }

  /** Subscribe to state changes (both directions, with metadata). Returns an
   *  unsubscribe fn. */
  onStateChange(listener: (update: StateUpdate<S>) => void): () => void {
    this.stateListeners.add(listener);
    return () => this.stateListeners.delete(listener);
  }

  /** Subscribe to `initialized` flips. Returns an unsubscribe fn. */
  onInitializedChange(listener: (initialized: boolean) => void): () => void {
    this.initListeners.add(listener);
    return () => this.initListeners.delete(listener);
  }

  private setInitialized(value: boolean) {
    if (this._initialized === value) return;
    this._initialized = value;
    for (const listener of this.initListeners) listener(value);
  }

  private emitState(update: StateUpdate<S>) {
    this._state = update;
    for (const listener of this.stateListeners) listener(update);
  }

  private pushError(error: LoroManagerError) {
    this._errors = [...this._errors, error];
  }

  /** Subscribe to the given mirror, dropping any prior subscription. The mirror
   *  fires for every state change (both directions, with metadata). */
  private subscribeMirror(mirror: Mirror<S>) {
    this.mirrorUnsub?.();
    this._mirror = mirror;
    this.mirrorUnsub = mirror.subscribe((update, metadata) => {
      this.emitState({ state: update, metadata });
    });
  }

  /** Util for awaiting the sync of the mirror to finish. */
  private async awaitMirrorSync() {
    await Promise.resolve();
    await Promise.resolve();
    await Promise.resolve();
  }

  importUpdate(
    update: LoroRawUpdate
  ): Result<boolean, ResultError<LoroManagerError>[]> {
    let importStatus: ImportStatus;

    try {
      importStatus = this._doc.import(update);
    } catch (e) {
      logSyncService({
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `importUpdate failed: ${e}`,
      });
      this.pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: `Failed to import update: ${e}`,
        },
      ]);
    }

    const didChange = Object.keys(importStatus.success).length > 0;

    if (Object.keys(importStatus.pending ?? {}).length > 0) {
      this.pushError(LoroManagerError.ImportFailed);
      return err([
        { code: LoroManagerError.ImportFailed, message: 'Import failed' },
      ]);
    }

    return ok(didChange);
  }

  importBatchUpdates(
    updates: LoroRawUpdate[]
  ): Result<boolean, ResultError<LoroManagerError>[]> {
    let importStatus: ImportStatus;

    try {
      importStatus = this._doc.importBatch(updates);
    } catch (e) {
      logSyncService({
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `importBatchUpdates failed: ${e}`,
      });
      this.pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: `Failed to import update: ${e}`,
        },
      ]);
    }

    const didChange = Object.keys(importStatus.success).length > 0;

    if (Object.keys(importStatus.pending ?? {}).length > 0) {
      this.pushError(LoroManagerError.ImportFailed);
      return err([
        { code: LoroManagerError.ImportFailed, message: 'Import failed' },
      ]);
    }

    return ok(didChange);
  }

  async initializeFromSnapshot(
    snapshot: LoroRawUpdate
  ): Promise<Result<void, ResultError<LoroManagerError>[]>> {
    const importResult = this.importUpdate(snapshot);

    if (importResult.isErr()) {
      const [error] = importResult.error;
      return err([{ code: error.code, message: error.message }]);
    }

    const mirror = createMirror(this._doc, this.schema);

    try {
      await this.awaitMirrorSync();
      const mirrorState = mirror.getState();
      this.emitState({
        state: mirrorState,
        metadata: {
          direction: SyncDirection.TO_LORO,
          tags: ['INITIALIZE'],
        },
      });
    } catch (e) {
      logSyncService({
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `initializeFromSnapshot: mirror sync failed: ${e}`,
      });
      this.pushError(LoroManagerError.InitializeFailed);
      return err([
        {
          code: LoroManagerError.InitializeFailed,
          message: `Failed to sync mirror: ${e}`,
        },
      ]);
    }

    this.setInitialized(true);
    this.subscribeMirror(mirror);

    return ok(undefined);
  }

  getUpdateSince(
    lastVersionVector: VersionVector
  ): Result<Uint8Array | undefined, ResultError<LoroManagerError>[]> {
    if (!this._initialized || !this._mirror) {
      return err([
        { code: LoroManagerError.NotInitialized, message: 'Not initialized' },
      ]);
    }
    const currentVersionVector = this._doc.version();
    /** Comparison between the current state, and the last synced state */
    const vvDiff = lastVersionVector.compare(currentVersionVector);

    if (vvDiff === 0) {
      return ok(undefined);
    }

    const spans = this._doc.findIdSpansBetween(
      this._doc.vvToFrontiers(lastVersionVector),
      this._doc.vvToFrontiers(currentVersionVector)
    );

    const localSpans = spans.forward.filter(
      (span) => span.peer === this._doc.peerIdStr
    );

    let update: RawUpdate;

    try {
      update = this._doc.export({
        mode: 'updates-in-range',
        spans: localSpans.map((span) => ({
          id: { peer: span.peer, counter: span.counter },
          len: span.length,
        })),
      });
    } catch (e) {
      logSyncService({
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `getUpdateSince: export failed: ${e}`,
      });
      this.pushError(LoroManagerError.ExportFailed);
      return err([
        {
          code: LoroManagerError.ExportFailed,
          message: `Failed to export update: ${e}`,
        },
      ]);
    }

    return ok(update);
  }

  getAllContainerIds(): Result<ContainerID[], ResultError<LoroManagerError>[]> {
    if (!this._initialized || !this._mirror) {
      return err([
        { code: LoroManagerError.NotInitialized, message: 'Not initialized' },
      ]);
    }

    return ok(this._mirror.getContainerIds());
  }

  async syncToLoro(
    state: InferType<S>
  ): Promise<Result<void, ResultError<LoroManagerError>[]>> {
    if (!this._initialized || !this._mirror) {
      return err([
        { code: LoroManagerError.NotInitialized, message: 'Not initialized' },
      ]);
    }

    try {
      this._mirror.setState(state, {
        tags: LoroStateTag.FromManager,
      });

      await this.awaitMirrorSync();
    } catch (e) {
      logSyncService({
        documentId: this.options.documentId,
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

    return ok(undefined);
  }

  async reset(
    snapshot: LoroRawUpdate
  ): Promise<Result<void, ResultError<LoroManagerError>[]>> {
    this.mirrorUnsub?.();
    this.mirrorUnsub = undefined;
    this._mirror?.dispose();
    this._doc.free();

    const newDoc = createLoroDoc();
    this._doc = newDoc;

    let importStatus: ImportStatus;
    try {
      importStatus = newDoc.import(snapshot);
    } catch (e) {
      logSyncService({
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `reset: snapshot import failed: ${e}`,
      });
      this.pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: `Failed to import snapshot: ${e}`,
        },
      ]);
    }

    if (Object.keys(importStatus.pending ?? {}).length > 0) {
      this.pushError(LoroManagerError.ImportFailed);
      return err([
        {
          code: LoroManagerError.ImportFailed,
          message: 'Snapshot import has pending updates',
        },
      ]);
    }

    const newMirror = createMirror(newDoc, this.schema);
    this.subscribeMirror(newMirror);

    await this.awaitMirrorSync();

    const state = newMirror.getState();
    this.emitState({
      state,
      metadata: {
        direction: SyncDirection.TO_LORO,
        tags: [LoroStateTag.Initialize],
      },
    });

    this.setInitialized(true);

    return ok(undefined);
  }

  getContainerById(
    id: ContainerID
  ): Result<Container | undefined, ResultError<LoroManagerError>[]> {
    let container: Container | undefined;

    try {
      container = this._doc.getContainerById(id);
    } catch (e) {
      logSyncService({
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `getContainerById failed: ${e}`,
      });
      this.pushError(LoroManagerError.GetContainerByIdFailed);
      return err([
        { code: LoroManagerError.GetContainerByIdFailed, message: String(e) },
      ]);
    }

    return ok(container);
  }

  getCursorPos(cursor: Cursor): Result<
    {
      update?: Cursor;
      offset: number;
      side: Side;
    },
    ResultError<LoroManagerError>[]
  > {
    let pos: { update?: Cursor; offset: number; side: Side } | undefined;
    try {
      pos = this._doc.getCursorPos(cursor);
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
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `getCursorPos failed: ${e}`,
      });
      this.pushError(LoroManagerError.GetCursorPosFailed);
      return err([
        { code: LoroManagerError.GetCursorPosFailed, message: String(e) },
      ]);
    }

    return ok(pos);
  }

  /**
   * First snapshot received is the one ingested, all others are automatically
   * ignored. Returns whether this snapshot became the seed.
   */
  async ingest(input: SnapshotIngest): Promise<boolean> {
    if (this._initialized) return false;

    const initResult = await this.initializeFromSnapshot(input.snapshot);
    if (initResult.isErr()) {
      logSyncService({
        documentId: this.options.documentId,
        level: 'error',
        context: {},
        message: `ingest(${input.kind}): seed failed`,
      });
      return false;
    }

    // WAL entries are causally anchored to the local snapshot, so they're only
    // safe to replay on top of the local seed we just applied.
    if (input.kind === 'local' && input.walUpdates?.length) {
      const replayResult = this.importBatchUpdates(input.walUpdates);
      if (replayResult.isErr()) {
        logSyncService({
          documentId: this.options.documentId,
          level: 'error',
          context: {},
          message: `ingest(${input.kind}): WAL replay failed`,
        });
      }
    }

    return true;
  }

  /** Tear down subscriptions and free the underlying doc. */
  dispose() {
    this.mirrorUnsub?.();
    this.mirrorUnsub = undefined;
    this.stateListeners.clear();
    this.initListeners.clear();
    this._mirror?.dispose();
    this._doc.free();
  }
}

export function createLoroManager<S extends GenericRootSchema>(
  schema: S,
  options: LoroManagerOptions
): LoroManager<S> {
  const manager = new LoroManager(schema, options);
  onCleanup(() => manager.dispose());
  return manager;
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
