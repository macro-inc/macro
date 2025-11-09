import { isErr } from '@core/util/maybeResult';
import { type InferType, SyncDirection } from '@loro-mirror/packages/core/src';
import { logger } from '@observability/logger';
import { Mutex } from 'async-mutex';
import type { Frontiers } from 'loro-crdt';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createEffect, createSignal, on } from 'solid-js';
import type { Awareness } from './awareness';
import { type LoroManager, LoroStateTag, type StateUpdate } from './manager';
import type { GenericRootSchema, LoroRawUpdate, RawUpdate } from './shared';
import type { SyncSource, TimeoutError } from './source';
import { compareLoroDocVersions, loroDocFromSnapshot } from './utils';

export type EngineBindings<S extends GenericRootSchema, D> = {
  /**
   * Callback for handling state updates from the remote
   * @param state - The serialized state
   */
  syncFromLoro: (state: InferType<S>) => void;
  onReset?: () => void;
  /**
   * Callback for handling awareness updates from the remote
   * @param awareness - The decoded awareness state
   */
  syncFromAwareness?: (awareness: D) => void;
};

export type Engine<S extends GenericRootSchema, D> = {
  /** Is the engine running ¯\_(ツ)_/¯  */
  readonly isRunning: Accessor<boolean>;
  /**
   * Update the local state, and sync it to the remote
   * @param state - The serialized state to push
   */
  syncStateToLoro: (state: InferType<S>) => Promise<void>;
  /**
   * Update the local awareness, and sync it to the remote
   * @param awareness - The decoded awareness state to push
   */
  syncAwarenessToLoro: (awareness: D) => void;
  /** Starts the sync engine */
  start: () => void;
  /** Stops the sync engine */
  stop: () => void;
  /**
   * Resets the sync engine
   * This will use the latest snapshot from the remote,
   * and re-create the manager from the snapshot
   */
  reset: () => void;
};

export function createSyncEngine<
  D,
  S extends GenericRootSchema = GenericRootSchema,
>(
  loroManager: LoroManager<S>,
  awareness: Awareness<D>,
  source: SyncSource,
  bindings: EngineBindings<S, D>,
  readonly: boolean = false
): Engine<S, D> {
  const [running, setRunning] = createSignal(false);
  const syncLock = new Mutex();

  const handleLocalUpdates = async (update: LoroRawUpdate) => {
    if (readonly) return;
    const peerId = loroManager.getPeerId();
    await source.pushUpdate(update, peerId).mapErr((err) => {
      logger.error('failed to push local update to remote', {
        scope: 'sync_engine',
        resolution: 'try to reconnect',
        err: err,
        documentId: source.documentId,
      });
      source.reconnect();
      return;
    });
  };

  /**
   * Handles remote updates from the other peers
   *
   * Takes the incoming peer update and imports i into the local loroDoc
   *
   * If the import fails, it will reset the engine
   *
   * @param update - The update to handle
   */
  const handleRemoteUpdate = async (update: RawUpdate) => {
    await syncLock.runExclusive(async () => {
      let importResult = loroManager.importUpdate(update);
      await Promise.resolve();
      if (isErr(importResult)) {
        logger.error('failed to import remote update', {
          resolution: 'reset engine',
          scope: 'sync_engine',
          err: importResult,
          documentId: source.documentId,
        });
        const error = importResult;
        console.error(error);
        resetEngine();
        return;
      }
    });
  };

  let unsubscribe: (() => void) | undefined;

  const start = () => {
    if (!loroManager.isInitialized()) {
      logger.warn('Loro manager not initialized, engine will not start', {
        documentId: source.documentId,
      });
      return;
    }

    unsubscribe?.();
    unsubscribe = loroManager.getDoc().subscribeLocalUpdates((update) => {
      handleLocalUpdates(update);
    });

    source.registerPeerId(loroManager.getPeerId());
    setRunning(true);
  };

  const stop = () => {
    unsubscribe?.();
    unsubscribe = undefined;

    awareness.updateLocalAwareness(undefined);
    source.pushAwareness(awareness.getEncodedLocalAwareness());
    setRunning(false);
  };

  const syncStateToLoro = async (state: InferType<S>) => {
    if (!running()) return;
    await syncLock.runExclusive(async () => {
      const syncResult = await loroManager.syncToLoro(state);

      // Failed to sync, try to reset the engine
      if (isErr(syncResult)) {
        let error = syncResult;
        logger.error('failed to sync state to remote', {
          resolution: 'reset engine',
          scope: 'sync_engine',
          err: error,
          documentId: source.documentId,
        });
        resetEngine();
      }
    });
  };

  type SnapshotThunk = () => ResultAsync<Uint8Array, TimeoutError>;

  const DEFAULT_SNAPSHOT_THUNK: SnapshotThunk = source.requestSnapshot;

  const resetEngine = async (snapshotThunk?: SnapshotThunk) => {
    const wasRunning = running();
    if (wasRunning) {
      stop();
    }

    await syncLock.runExclusive(async () => {
      let snapshot = await (snapshotThunk ?? DEFAULT_SNAPSHOT_THUNK)();
      if (snapshot.isErr()) {
        logger.error('failed to get snapshot from source', {
          resolution: 'fail',
          scope: 'sync_engine',
          err: snapshot.error,
          documentId: source.documentId,
        });
        return;
      }

      let resetResult = await loroManager.reset(snapshot.value);
      if (isErr(resetResult)) {
        logger.error('failed to reset engine or loro manager', {
          resolution: 'fail',
          scope: 'sync_engine',
          err: resetResult,
          documentId: source.documentId,
        });
        return;
      }
    });

    if (wasRunning) {
      start();
    }
  };

  /**
   * Sync local awareness to peers and local ephemeral store
   * @param awarenessUpdate
   */
  const syncAwarenessToLoro = (awarenessUpdate: D) => {
    if (!running()) return;
    // Update the local ephemeral store with the new awareness
    awareness.updateLocalAwareness(awarenessUpdate);
    // Push the awareness updates to be synced with the other peers
    source.pushAwareness(awareness.getEncodedLocalAwareness());
  };

  /**
   * Requests all updates since the current version of the document from the source
   * and applies them to the local document
   *
   * @param since - The version to request updates since
   */
  const requestAndHandleUpdatesSince = async (since: Frontiers) => {
    const updates = await source.requestUpdatesSince(since);
    if (updates.isErr() || !updates.value) {
      console.error(
        'failed to request updates since',
        'error' in updates ? updates.error : 'update is undefined'
      );
      return;
    }

    handleRemoteUpdate(updates.value);
  };

  createEffect(() => {
    if (!running()) return;

    source.listen(async (event) => {
      switch (event.type) {
        case 'update':
          handleRemoteUpdate(event.update);
          break;
        case 'awareness':
          awareness.importRemoteAwareness(event.awareness);
          break;
        case 'incremental_snapshot':
          handleRemoteUpdate(event.snapshot);
          break;
        case 'reconnect': {
          const doc = loroManager.getDoc();
          const tempDoc = loroDocFromSnapshot(event.snapshot);
          const cmp = compareLoroDocVersions(doc, tempDoc);
          if (cmp >= 0) {
            return;
          }
          logger.log('reconnecting and fast forwarding new updates', {
            documentId: source.documentId,
          });
          requestAndHandleUpdatesSince(doc.frontiers());
        }
      }
    });
  });

  createEffect(
    on(loroManager.state, (stateUpdate: StateUpdate<S> | undefined) => {
      if (
        // Engine is not running
        !running() ||
        // Update is empty
        !stateUpdate ||
        // Update is from ourselves
        stateUpdate.metadata.direction === SyncDirection.TO_LORO ||
        // Update is from the initial sync
        stateUpdate.metadata.tags?.includes(LoroStateTag.Initialize)
      ) {
        return;
      }
      syncLock.runExclusive(async () => {
        bindings.syncFromLoro(stateUpdate.state);
      });
    })
  );

  createEffect(
    on(awareness.local, (_) => {
      if (!running()) return;
      const awarenessUpdate = awareness.getEncodedLocalAwareness();
      if (!awarenessUpdate) return;
      source.pushAwareness(awarenessUpdate);
    })
  );

  return {
    isRunning: running,
    syncStateToLoro,
    syncAwarenessToLoro,
    start,
    stop,
    reset: resetEngine,
  };
}
