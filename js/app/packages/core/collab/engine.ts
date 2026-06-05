import { type InferType, SyncDirection } from '@loro-mirror/packages/core/src';
import { logger } from '@observability/logger';
import { Mutex } from 'async-mutex';
import type { Frontiers } from 'loro-crdt';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type { Awareness } from './awareness';
import { type LoroManager, LoroStateTag, type StateUpdate } from './manager';
import type { GenericRootSchema, LoroRawUpdate, RawUpdate } from './shared';
import type { SyncSource, SyncSourceEvent, TimeoutError } from './source';
import { compareLoroDocVersions, loroDocFromSnapshot } from './utils';

export type EngineBindings<S extends GenericRootSchema> = {
  onRemoteState: (state: InferType<S>) => void;
};

type SnapshotThunk = () => ResultAsync<Uint8Array, TimeoutError>;

export class SyncEngine<S extends GenericRootSchema, D> {
  private _isRunning = false;
  get isRunning() {
    return this._isRunning;
  }

  private readonly syncLock = new Mutex();
  private unsubscribe?: () => void;
  private readonly defaultSnapshotThunk: SnapshotThunk;
  private readonly onRunningChange: (v: boolean) => void;

  constructor(
    private readonly loroManager: LoroManager<S>,
    private readonly awareness: Awareness<D>,
    private readonly source: SyncSource,
    private readonly bindings: EngineBindings<S>,
    private readonly readonly: () => boolean = () => false,
    { onRunningChange = () => {} }: { onRunningChange?: (v: boolean) => void } = {}
  ) {
    this.defaultSnapshotThunk = source.requestSnapshot;
    this.onRunningChange = onRunningChange;
  }

  public start(): boolean {
    if (!this.loroManager.isInitialized()) {
      logger.warn('Loro manager not initialized, engine will not start', {
        documentId: this.source.documentId,
      });
      return false;
    }

    this.unsubscribe?.();
    this.unsubscribe = this.loroManager.getDoc().subscribeLocalUpdates((update) => {
      this.handleLocalUpdates(update);
    });

    this.source.listen((event) => this.handleSourceEvent(event));
    this.source.registerPeerId(this.loroManager.getPeerId());
    this._isRunning = true;
    this.onRunningChange(true);
    return true;
  }

  public stop() {
    this.unsubscribe?.();
    this.unsubscribe = undefined;

    this.awareness.updateLocalAwareness(undefined);
    this.source.pushAwareness(this.awareness.getEncodedLocalAwareness());
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
          documentId: this.source.documentId,
        });
        this.reset();
      }
    });
  }

  public syncAwarenessToLoro(awarenessUpdate: D) {
    if (!this._isRunning) return;
    this.awareness.updateLocalAwareness(awarenessUpdate);
    this.source.pushAwareness(this.awareness.getEncodedLocalAwareness());
  }

  public async reset(snapshotThunk?: SnapshotThunk) {
    const wasRunning = this._isRunning;
    if (wasRunning) {
      this.stop();
    }

    await this.syncLock.runExclusive(async () => {
      let snapshot = await (snapshotThunk ?? this.defaultSnapshotThunk)();
      if (snapshot.isErr()) {
        logger.error('failed to get snapshot from source', {
          resolution: 'fail',
          scope: 'sync_engine',
          err: snapshot.error,
          documentId: this.source.documentId,
        });
        return;
      }

      let resetResult = await this.loroManager.reset(snapshot.value);
      if (resetResult.isErr()) {
        logger.error('failed to reset engine or loro manager', {
          resolution: 'fail',
          scope: 'sync_engine',
          err: resetResult,
          documentId: this.source.documentId,
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
    this.syncLock.runExclusive(() => this.bindings.onRemoteState(stateUpdate.state));
  }

  public onLocalAwarenessChange() {
    if (!this._isRunning) return;
    const awarenessUpdate = this.awareness.getEncodedLocalAwareness();
    if (!awarenessUpdate) return;
    this.source.pushAwareness(awarenessUpdate);
  }

  private async handleLocalUpdates(update: LoroRawUpdate) {
    if (this.readonly()) return;
    const peerId = this.loroManager.getPeerId();
    const delivered = await this.source.pushUpdate(update, peerId);
    console.log(delivered);
    if (!delivered) {
      logger.error('failed to push local update to remote', {
        scope: 'sync_engine',
        resolution: 'try to reconnect',
        documentId: this.source.documentId,
      });
      this.source.reconnect();
    }
  }

  private async handleRemoteUpdate(update: RawUpdate) {
    await this.syncLock.runExclusive(async () => {
      let importResult = this.loroManager.importUpdate(update);
      await Promise.resolve();
      if (importResult.isErr()) {
        logger.error('failed to import remote update', {
          resolution: 'reset engine',
          scope: 'sync_engine',
          err: importResult,
          documentId: this.source.documentId,
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
        const doc = this.loroManager.getDoc();
        const tempDoc = loroDocFromSnapshot(event.snapshot);
        const cmp = compareLoroDocVersions(doc, tempDoc);
        if (cmp >= 0) return;
        logger.log('reconnecting and fast forwarding new updates', {
          documentId: this.source.documentId,
        });
        this.requestAndHandleUpdatesSince(doc.frontiers());
        break;
      }
    }
  }

  private async requestAndHandleUpdatesSince(since: Frontiers) {
    const updates = await this.source.requestUpdatesSince(since);
    if (updates.isErr() || !updates.value) {
      console.error(
        'failed to request updates since',
        'error' in updates ? updates.error : 'update is undefined'
      );
      return;
    }

    this.handleRemoteUpdate(updates.value);
  }
}

export type ReactiveSyncEngine<S extends GenericRootSchema, D> = {
  isRunning: Accessor<boolean>;
  start: () => void;
  stop: () => void;
  reset: (snapshotThunk?: () => ResultAsync<Uint8Array, TimeoutError>) => Promise<void>;
  syncStateToLoro: (state: InferType<S>) => Promise<void>;
  syncAwarenessToLoro: (awareness: D) => void;
};

export function createSyncEngine<
  D,
  S extends GenericRootSchema = GenericRootSchema,
>(
  loroManager: LoroManager<S>,
  awareness: Awareness<D>,
  source: SyncSource,
  bindings: EngineBindings<S>,
  readonly: Accessor<boolean> = () => false
): ReactiveSyncEngine<S, D> {
  const [isRunning, setIsRunning] = createSignal(false);

  const engine = new SyncEngine(loroManager, awareness, source, bindings, readonly, {
    onRunningChange: setIsRunning,
  });

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
