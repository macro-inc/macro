import { type InferType, SyncDirection } from '@loro-mirror/packages/core/src';
import { logger } from '@observability/logger';
import { Mutex } from 'async-mutex';
import type { VersionVector } from 'loro-crdt';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import { match } from 'ts-pattern';
import type { Awareness } from './awareness';
import { type LoroManager, LoroStateTag, type StateUpdate } from './manager';
import type { GenericRootSchema, LoroRawUpdate, RawUpdate } from './shared';
import type { SnapshotStore } from './snapshot-store';

// SnapshotStore in the engine is always Loro updates — RawUpdate.
type LoroSnapshotStore = SnapshotStore<RawUpdate>;

import type { LiveSyncSource, SyncSourceEvent, TimeoutError } from './source';
import type { WALSyncer } from './wal';

const SNAPSHOT_INTERVAL_MS = 5_000;

const REQUEST_UPDATES_MAX_ATTEMPTS = 3;
const REQUEST_UPDATES_RETRY_DELAY_MS = 2_000;

export type EngineBindings<S extends GenericRootSchema> = {
  onRemoteState: (state: InferType<S>) => void;
};

export type SyncSources = {
  wal: WALSyncer<RawUpdate>;
  live: LiveSyncSource;
};

export type SyncEngineParams<S extends GenericRootSchema, D> = {
  loroManager: LoroManager<S>;
  awareness: Awareness<D>;
  syncs: SyncSources;
  bindings: EngineBindings<S>;
  readonly?: () => boolean;
  onRunningChange?: (v: boolean) => void;
  snapshotStore?: LoroSnapshotStore;
};

type SnapshotThunk = () => ResultAsync<Uint8Array, TimeoutError>;

const CROSS_TAB_CHANNEL_PREFIX = 'macro-loro-';

type CrossTabMessage =
  | { type: 'update'; data: RawUpdate }
  | { type: 'awareness'; data: RawUpdate };

export class SyncEngine<S extends GenericRootSchema, D> {
  private _isRunning = false;

  get isRunning() {
    return this._isRunning;
  }

  private readonly loroManager: LoroManager<S>;
  private readonly awareness: Awareness<D>;
  private readonly syncs: SyncSources;
  private readonly bindings: EngineBindings<S>;
  private readonly readonly: () => boolean;
  private readonly syncLock = new Mutex();
  private unsubscribe?: () => void;
  private snapshotInterval?: ReturnType<typeof setInterval>;
  private readonly snapshotStore?: LoroSnapshotStore;
  private readonly defaultSnapshotThunk: SnapshotThunk;
  private readonly onRunningChange: (v: boolean) => void;
  private crossTabChannel?: BroadcastChannel;

  constructor({
    loroManager,
    awareness,
    syncs,
    bindings,
    readonly = () => false,
    onRunningChange = () => {},
    snapshotStore,
  }: SyncEngineParams<S, D>) {
    this.loroManager = loroManager;
    this.awareness = awareness;
    this.syncs = syncs;
    this.bindings = bindings;
    this.readonly = readonly;
    this.defaultSnapshotThunk = syncs.live.requestSnapshot;
    this.onRunningChange = onRunningChange;
    this.snapshotStore = snapshotStore;
  }

  public start(): boolean {
    if (this._isRunning) return true; // already running — idempotent

    if (!this.loroManager.isInitialized()) {
      logger.warn('Loro manager not initialized, engine will not start', {
        documentId: this.syncs.live.documentId,
      });
      return false;
    }

    this.unsubscribe?.();
    this.unsubscribe = this.loroManager
      .getDoc()
      .subscribeLocalUpdates((update) => {
        this.handleLocalUpdates(update);
      });

    this.crossTabChannel = new BroadcastChannel(
      `${CROSS_TAB_CHANNEL_PREFIX}${this.syncs.live.documentId}`
    );
    this.crossTabChannel.onmessage = (e: MessageEvent<CrossTabMessage>) => {
      match(e.data)
        .with(
          { type: 'update' },
          (msg) => void this.handleRemoteUpdate(msg.data)
        )
        .with({ type: 'awareness' }, (msg) =>
          this.awareness.importRemoteAwareness(msg.data)
        )
        .exhaustive();
    };

    this.syncs.live.listen((event) => this.handleSourceEvent(event));
    this.syncs.live.registerPeerId(this.loroManager.getPeerId());

    if (this.snapshotStore && this.snapshotInterval === undefined) {
      this.snapshotInterval = setInterval(
        () => void this.persistSnapshot(),
        SNAPSHOT_INTERVAL_MS
      );
    }

    this._isRunning = true;
    this.onRunningChange(true);
    return true;
  }

  public stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    this.crossTabChannel?.close();
    this.crossTabChannel = undefined;

    if (this.snapshotInterval !== undefined) {
      clearInterval(this.snapshotInterval);
      this.snapshotInterval = undefined;
    }

    this.awareness.updateLocalAwareness(undefined);
    this.syncs.live.pushAwareness(this.awareness.getEncodedLocalAwareness());
    this._isRunning = false;
    this.onRunningChange(false);
  }

  public async syncStateToLoro(state: InferType<S>) {
    if (!this._isRunning) return;

    await this.syncLock.runExclusive(async () => {
      const syncResult = await this.loroManager.syncToLoro(state);

      if (syncResult.isErr()) {
        logger.error('failed to sync state to remote', {
          resolution: 'reset engine',
          scope: 'sync_engine',
          err: syncResult,
          documentId: this.syncs.live.documentId,
        });
        this.reset();
      }
    });
  }

  public syncAwarenessToLoro(awarenessUpdate: D) {
    if (!this._isRunning) return;

    this.awareness.updateLocalAwareness(awarenessUpdate);
    this.syncs.live.pushAwareness(this.awareness.getEncodedLocalAwareness());
  }

  public async reset(snapshotThunk?: SnapshotThunk) {
    const wasRunning = this._isRunning;

    if (wasRunning) {
      this.stop();
    }

    await this.syncLock.runExclusive(async () => {
      const snapshot = await (snapshotThunk ?? this.defaultSnapshotThunk)();
      if (snapshot.isErr()) {
        logger.error('failed to get snapshot from source', {
          resolution: 'fail',
          scope: 'sync_engine',
          err: snapshot.error,
          documentId: this.syncs.live.documentId,
        });
        return;
      }

      const resetResult = await this.loroManager.reset(snapshot.value);
      if (resetResult.isErr()) {
        logger.error('failed to reset engine or loro manager', {
          resolution: 'fail',
          scope: 'sync_engine',
          err: resetResult,
          documentId: this.syncs.live.documentId,
        });
        return;
      }
    });

    if (wasRunning) {
      this.start();
    }
  }

  public onStateUpdate(stateUpdate: StateUpdate<S> | undefined) {
    if (!this._isRunning || !stateUpdate) return;

    if (stateUpdate.metadata.direction === SyncDirection.TO_LORO) return;
    if (stateUpdate.metadata.tags?.includes(LoroStateTag.Initialize)) return;
    this.syncLock.runExclusive(() =>
      this.bindings.onRemoteState(stateUpdate.state)
    );
  }

  public onLocalAwarenessChange() {
    if (!this._isRunning) return;

    const awarenessUpdate = this.awareness.getEncodedLocalAwareness();
    if (!awarenessUpdate) return;
    this.syncs.live.pushAwareness(awarenessUpdate);
    this.crossTabChannel?.postMessage({
      type: 'awareness',
      data: awarenessUpdate,
    });
  }

  private async handleLocalUpdates(update: LoroRawUpdate) {
    if (this.readonly()) return;
    void this.syncs.wal.append(update);
    this.crossTabChannel?.postMessage({ type: 'update', data: update });
  }

  private async persistSnapshot() {
    if (!this.snapshotStore) return;

    void this.syncs.wal.flush(); // unawaited

    try {
      const doc = this.loroManager.getDoc();
      const snapshot = doc.export({
        mode: 'shallow-snapshot',
        frontiers: doc.oplogFrontiers(),
      });
      await this.snapshotStore.save(snapshot);
      // now safe to drop WAL entries it captures. we prune only
      // after the save succeeds so that we can always recover fully.
      await this.syncs.wal.pruneDelivered();
    } catch (err) {
      // DOMException's name/message aren't own-enumerable, so logging the
      // bare object hides everything but the type. Pull them out by hand.
      logger.error('failed to persist snapshot', {
        scope: 'sync_engine',
        documentId: this.syncs.live.documentId,
        errName: err instanceof Error ? err.name : undefined,
        errMessage: err instanceof Error ? err.message : String(err),
        err,
      });
    }
  }

  private async handleRemoteUpdate(update: RawUpdate) {
    await this.syncLock.runExclusive(async () => {
      const importResult = this.loroManager.importUpdate(update);
      await Promise.resolve();
      if (importResult.isErr()) {
        logger.error('failed to import remote update', {
          resolution: 'reset engine',
          scope: 'sync_engine',
          err: importResult,
          documentId: this.syncs.live.documentId,
        });
        console.error(importResult);
        this.reset();
        return;
      }
    });
  }

  private handleSourceEvent(event: SyncSourceEvent) {
    switch (event.type) {
      case 'update':
        this.handleRemoteUpdate(event.update);
        break;
      case 'awareness':
        this.awareness.importRemoteAwareness(event.awareness);
        break;
      case 'incremental_snapshot':
        this.handleRemoteUpdate(event.snapshot);
        break;
      case 'reconnect': {
        logger.log('reconnecting, requesting updates since current version', {
          documentId: this.syncs.live.documentId,
        });
        this.requestAndHandleUpdatesSince(this.loroManager.getDoc().version());
        break;
      }
    }
  }

  private async requestAndHandleUpdatesSince(
    since: VersionVector,
    attempt = 1
  ) {
    const updates = await this.syncs.live.requestUpdatesSince(since);
    if (updates.isErr() || !updates.value) {
      console.error(
        'failed to request updates since',
        'error' in updates ? updates.error : 'update is undefined'
      );
      if (updates.isErr() && attempt < REQUEST_UPDATES_MAX_ATTEMPTS) {
        await new Promise((resolve) =>
          setTimeout(resolve, REQUEST_UPDATES_RETRY_DELAY_MS)
        );
        void this.requestAndHandleUpdatesSince(since, attempt + 1);
      }
      return;
    }

    this.handleRemoteUpdate(updates.value);
  }
}

export type ReactiveSyncEngine<S extends GenericRootSchema, D> = {
  isRunning: Accessor<boolean>;
  start: () => void;
  stop: () => void;
  reset: (
    snapshotThunk?: () => ResultAsync<Uint8Array, TimeoutError>
  ) => Promise<void>;
  syncStateToLoro: (state: InferType<S>) => Promise<void>;
  syncAwarenessToLoro: (awareness: D) => void;
};

export function createSyncEngine<
  D,
  S extends GenericRootSchema = GenericRootSchema,
>(
  params: Omit<SyncEngineParams<S, D>, 'onRunningChange'> & {
    readonly?: Accessor<boolean>;
  }
): ReactiveSyncEngine<S, D> {
  const [isRunning, setIsRunning] = createSignal(false);

  const engine = new SyncEngine({ ...params, onRunningChange: setIsRunning });
  const { loroManager, awareness } = params;

  createEffect(on(loroManager.state, (update) => engine.onStateUpdate(update)));
  createEffect(on(awareness.local, () => engine.onLocalAwarenessChange()));

  return {
    isRunning,
    start: () => engine.start(),
    stop: () => engine.stop(),
    reset: (t) => engine.reset(t),
    syncStateToLoro: (state) => engine.syncStateToLoro(state),
    syncAwarenessToLoro: (a) => engine.syncAwarenessToLoro(a),
  };
}
