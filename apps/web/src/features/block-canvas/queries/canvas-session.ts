import {
  endTrackedDocumentSpan,
  registerDocumentSpan,
} from '@block-md/observability';
import { fireAndForget } from '@core/util/fireAndForget';
import { schema } from '@loro-mirror/core';
import { createAwareness } from '@macro-inc/collaboration/collab/awareness';
import type { Chatter } from '@macro-inc/collaboration/collab/chatter';
import { createSyncEngine } from '@macro-inc/collaboration/collab/engine';
import {
  LoroManager,
  LoroManagerError,
} from '@macro-inc/collaboration/collab/manager';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
  loadCachedState,
  type SnapshotStore,
} from '@macro-inc/collaboration/collab/snapshot-store';
import {
  type InitialSync,
  type LiveSyncSource,
  SyncError,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import {
  BrowserWALStore,
  LORO_WAL_DB_NAME,
  type WALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { PeerPresence } from '@macro-inc/graphics/loro';
import { Telemetry } from '@macro-inc/observability';
import type { LoroDoc } from 'loro-crdt';
import { err, errAsync, type ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from 'solid-js';
import { createCanvasSeed, readSharedCanvas } from '../core/collaboration';
import type { CanvasFile } from '../core/document-format';
import { decodeCanvasPresence } from '../core/presence';

type CanvasConnection = {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, SyncError>;
};
export type CanvasSessionOptions = {
  documentId: string;
  initial: CanvasFile;
  requireShared?: boolean;
  userId?: string;
  canEdit: Accessor<boolean>;
  exists: () => Promise<boolean>;
  initialize: (snapshot: Uint8Array) => Promise<void>;
  connect: () => CanvasConnection;
  authorize?: () => Promise<void>;
  persistence?: {
    snapshots: SnapshotStore<Uint8Array>;
    wal: WALStore<Uint8Array>;
    makeChatter?: (documentId: string) => Chatter;
  };
};
type CanvasSessionState =
  | { t: 'loading' }
  | { t: 'unshared' }
  | { t: 'ready'; doc: LoroDoc }
  | { t: 'error'; message: string };

// Successive mounts share an IndexedDB key. An old in-flight snapshot must
// finish before a replacement session loads its recovery base.
const snapshotOperations = new Map<string, Promise<void>>();
function serializeSnapshot<T>(
  id: string,
  operation: () => Promise<T>
): Promise<T> {
  const previous = snapshotOperations.get(id) ?? Promise.resolve();
  const run = async () => {
    await previous;
    return operation();
  };
  const result = run();
  const finish = async () => {
    try {
      await result;
    } catch {
      /* The caller observes the failure. */
    }
    if (snapshotOperations.get(id) === settled) snapshotOperations.delete(id);
  };
  const settled = finish();
  snapshotOperations.set(id, settled);
  return result;
}

/** Durable scene ownership uses the same engine, WAL and transport as documents. */
export function createCanvasSession(options: CanvasSessionOptions) {
  const owner = getOwner();
  let resetWork = Promise.resolve();
  class CanvasManager extends LoroManager {
    override reset(snapshot: Uint8Array) {
      const work = this.recoverSnapshot(snapshot);
      const settle = async () => {
        await work;
      };
      resetWork = settle();
      return work;
    }
    private async recoverSnapshot(snapshot: Uint8Array) {
      const from = this.doc.oplogVersion();
      const count = this.doc.opCount();
      try {
        // The engine stops before resetting. Capture a final typing draft in
        // the WAL explicitly, before replacing its document or history owner.
        finishEdits();
        if (this.doc.opCount() !== count)
          await wal.append(this.doc.export({ mode: 'update', from }));
        await lastAppend;
        if (disposed || failedUpdates.size)
          return err([
            {
              code: LoroManagerError.ImportFailed,
              message: 'Local canvas changes must be saved before recovery.',
            },
          ]);
        resetting = true;
        setState({ t: 'loading' });
        const result = await super.reset(snapshot);
        if (disposed) return result;
        if (result.isErr()) {
          setState({
            t: 'error',
            message:
              'Unable to recover the shared canvas. Local changes were preserved.',
          });
          return result;
        }
        await replayWAL();
        if (disposed) return result;
        readSharedCanvas(this.doc);
        observeValidation();
        if (!disposed) setState({ t: 'ready', doc: this.doc });
        return result;
      } catch (cause) {
        if (!disposed && resetting)
          setState({
            t: 'error',
            message:
              'Unable to recover canvas changes. Your local data was preserved.',
          });
        else if (!disposed)
          setFailure(
            'Unable to recover canvas changes. Keep this tab open and download a copy.'
          );
        return err([
          {
            code: LoroManagerError.ImportFailed,
            message:
              cause instanceof Error
                ? cause.message
                : 'Canvas recovery failed.',
          },
        ]);
      } finally {
        from.free();
        resetting = false;
      }
    }
  }
  const manager = new CanvasManager(schema({}), {
    documentId: options.documentId,
    // The graphics backend owns the typed scene Mirror on this same document.
    mirror: false,
  });
  const [state, setState] = createSignal<CanvasSessionState>({ t: 'loading' });
  const [connection, setConnection] = createSignal<CanvasConnection>();
  const [pending, setPending] = createSignal(false);
  const [appends, setAppends] = createSignal(0);
  const [failure, setFailure] = createSignal<string>();
  let disposed = false;
  let started = false;
  let resetting = false;
  const failedUpdates = new Set<Uint8Array>();
  let finishEdits = () => {};
  let validationDoc: LoroDoc | undefined;
  let stopValidation = () => {};
  let lastAppend = Promise.resolve();
  const walStore =
    options.persistence?.wal ??
    new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, options.documentId);
  const snapshotStore =
    options.persistence?.snapshots ??
    new IDBSnapshotStore<Uint8Array>(LORO_SNAPSHOT_DB_NAME, options.documentId);
  // Finish writes already in progress before releasing the document at teardown.
  let snapshotWork = Promise.resolve();
  const snapshots: SnapshotStore<Uint8Array> = {
    load: () =>
      serializeSnapshot(options.documentId, () => snapshotStore.load()),
    delete: () =>
      serializeSnapshot(options.documentId, () => snapshotStore.delete()),
    save(snapshot) {
      const save = async () => {
        if (disposed)
          throw new Error('Canvas session closed before snapshot save.');
        await snapshotStore.save(snapshot);
      };
      const work = serializeSnapshot(options.documentId, save);
      const settle = async () => {
        try {
          await work;
        } catch {
          /* Preserve the previous recovery base. */
        }
      };
      snapshotWork = settle();
      return work;
    },
  };
  class CanvasWAL extends WALSyncer<Uint8Array> {
    override append(update: Uint8Array): Promise<void> {
      setPending(true);
      setAppends((value) => value + 1);
      const previous = lastAppend;
      const work = super.append(update);
      const finish = async () => {
        try {
          await work;
          failedUpdates.delete(update);
        } catch {
          failedUpdates.add(update);
          setFailure(
            'Canvas changes could not be saved locally. Keep this tab open.'
          );
        } finally {
          setAppends((value) => value - 1);
        }
      };
      const join = async () => {
        await Promise.all([previous, finish()]);
      };
      lastAppend = join();
      return lastAppend;
    }
    override async flush(): Promise<void> {
      await super.flush();
      if (!disposed) setPending((await this.summary()).dirty > 0);
    }
  }
  const wal = new CanvasWAL(
    walStore,
    (updates) =>
      options.canEdit()
        ? (connection()?.source.pushUpdate(updates) ?? Promise.resolve(false))
        : Promise.resolve(false),
    options.documentId
  );
  const awareness = createAwareness<string, PeerPresence | null>(
    manager.peerIdStr,
    options.userId,
    {
      encode: (value) => JSON.stringify(value),
      decode: decodeCanvasPresence,
    }
  );
  const listeners = new Set<(event: SyncSourceEvent) => void>();
  let peerId: bigint | undefined;
  const unavailable = () => errAsync(SyncError.connectionFailed());
  const live: LiveSyncSource = {
    documentId: options.documentId,
    status: () => connection()?.source.status() ?? SyncSourceStatus.Connecting,
    listen(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    pushUpdate: (updates) =>
      connection()?.source.pushUpdate(updates) ?? Promise.resolve(false),
    pushAwareness: (value) => connection()?.source.pushAwareness(value),
    registerPeerId(value) {
      peerId = value;
      connection()?.source.registerPeerId(value);
    },
    requestUpdatesSince: (version) =>
      connection()?.source.requestUpdatesSince(version) ?? unavailable(),
    requestSnapshot: () =>
      connection()?.source.requestSnapshot() ?? unavailable(),
    reconnect: () => connection()?.source.reconnect(),
    cleanup: () => connection()?.source.cleanup(),
  };
  const engine = createSyncEngine({
    loroManager: manager,
    awareness,
    syncs: { live, wal },
    bindings: { onRemoteState: () => {} },
    readonly: () => !options.canEdit(),
    snapshotStore: snapshots,
    makeChatter: options.persistence?.makeChatter,
  });
  const unsubscribeManager = manager.onStateChange(() => {
    if (!started || disposed || resetting) return;
    try {
      readSharedCanvas(manager.doc);
      observeValidation();
      setState({ t: 'ready', doc: manager.doc });
    } catch (cause) {
      setState({
        t: 'error',
        message:
          cause instanceof Error ? cause.message : 'Invalid shared canvas.',
      });
    }
  });
  function observeValidation() {
    if (validationDoc === manager.doc) return;
    stopValidation();
    validationDoc = manager.doc;
    stopValidation = manager.doc.subscribe((batch) => {
      if (disposed || batch.by !== 'import') return;
      try {
        readSharedCanvas(manager.doc);
      } catch (cause) {
        setState({
          t: 'error',
          message:
            cause instanceof Error ? cause.message : 'Invalid shared canvas.',
        });
      }
    });
  }
  async function start() {
    readSharedCanvas(manager.doc);
    await snapshots.save(manager.doc.export({ mode: 'snapshot' }));
    if (disposed) return;
    engine.start();
    started = true;
    observeValidation();
    setState({ t: 'ready', doc: manager.doc });
    if (options.canEdit()) await wal.flush();
  }
  async function accept(initial: InitialSync) {
    if (disposed) return;
    const result = manager.initialized
      ? manager.importUpdate(initial.snapshot)
      : await manager.initializeFromSnapshot(initial.snapshot);
    if (disposed) return;
    if (result.isErr())
      throw new Error(
        'Unable to merge the shared canvas. Your local changes were preserved.'
      );
    // A lost/corrupt cache can leave valid undelivered WAL entries. Replay them
    // against the server seed too, before sending them or exposing the scene.
    await replayWAL();
    readSharedCanvas(manager.doc);
    if (initial.awareness.length)
      awareness.importRemoteAwareness(initial.awareness);
    if (!started) await start();
    if (options.canEdit()) await wal.flush();
    if (!failedUpdates.size) setFailure(undefined);
  }
  async function replayWAL() {
    for (const entry of await walStore.getAll()) {
      if (disposed) return;
      const replay = manager.importUpdate(entry.update);
      if (
        replay.isErr() &&
        !replay.error.every(
          (error) => error.code === LoroManagerError.ImportPending
        )
      )
        throw new Error(
          'Unable to recover local canvas changes. Your local data was preserved.'
        );
    }
  }
  async function hydrate() {
    await wal.ready();
    if (disposed) return;
    const cached = await loadCachedState(manager, snapshots, walStore);
    if (disposed) return;
    if (cached) await start();
    await options.authorize?.();
    if (disposed) return;
    if (!cached && !(await options.exists())) {
      if (options.requireShared)
        throw new Error(
          'Canvas shared content is not initialized. Creation must complete before opening it.'
        );
      if (disposed) return;
      if (!options.canEdit()) setState({ t: 'unshared' });
      else {
        try {
          await options.initialize(
            createCanvasSeed(options.initial, options.documentId)
          );
        } catch (cause) {
          // A competing initializer wins atomically in the document's Durable Object.
          if (!(await options.exists())) throw cause;
        }
      }
    }
    if (disposed) return;
    const opened = runWithOwner(owner, options.connect);
    if (!opened) return;
    setConnection(opened);
    opened.source.listen((event) => {
      if (disposed) return;
      for (const listener of listeners) listener(event);
      if (event.type === 'connect' || event.type === 'reconnect') {
        fireAndForget(recover(event), 'canvas-session');
      }
    });
    if (peerId !== undefined) opened.source.registerPeerId(peerId);
    const initial = await opened.doInitialSync();
    if (disposed) return;
    if (initial.isErr()) {
      if (!started && state().t !== 'unshared')
        throw new Error(
          `Canvas initial sync failed (${initial.error.type}; connection: ${SyncSourceStatus[opened.source.status()]}). Your local data was preserved.`
        );
      return;
    }
    await accept(initial.value);
  }
  let hydration = Promise.resolve();
  function initialize() {
    hydration = runInitialization();
    return hydration;
  }
  async function runInitialization() {
    const span = Telemetry.span('canvas.open');
    span.setAttr('document.id', options.documentId);
    span.setAttr('document.type', 'canvas');
    registerDocumentSpan(options.documentId, span);
    try {
      await span.span('canvas.hydrate', hydrate);
    } catch (cause) {
      span.error(cause);
      if (!disposed && started)
        setFailure(
          'Live canvas sync is unavailable. Local changes are preserved.'
        );
      else if (!disposed)
        setState({
          t: 'error',
          message:
            cause instanceof Error
              ? cause.message
              : 'Unable to open this canvas.',
        });
    } finally {
      endTrackedDocumentSpan(span);
    }
  }
  const initialization = initialize();
  let recovery = Promise.resolve();
  function recover(initial: InitialSync): Promise<void> {
    const previous = recovery;
    const run = async () => {
      await previous;
      await initialization;
      if (disposed) return;
      try {
        await accept(initial);
      } catch (cause) {
        if (!disposed)
          setFailure(
            cause instanceof Error
              ? cause.message
              : 'Unable to reconnect to this canvas.'
          );
      }
    };
    recovery = run();
    return recovery;
  }
  async function flush() {
    let appended: Promise<void>;
    do {
      appended = lastAppend;
      await appended;
      await wal.flush();
    } while (appended !== lastAppend);
    return !pending() && appends() === 0 && !failure();
  }
  async function retrySave() {
    await lastAppend;
    if (disposed) return false;
    for (const update of [...failedUpdates]) await wal.append(update);
    if (disposed) return false;
    if (!failedUpdates.size) setFailure(undefined);
    if (!connection()) await initialize();
    else live.reconnect();
    return flush();
  }
  async function close() {
    await initialization;
    await recovery;
    await hydration;
    await resetWork;
    await lastAppend;
    await snapshotWork;
    manager.dispose();
  }
  onCleanup(() => {
    finishEdits();
    disposed = true;
    // A replacement mount must not read the WAL before the final local append
    // from this mount finishes (including a text draft committed above).
    fireAndForget(
      serializeSnapshot(options.documentId, async () => {
        await lastAppend;
      }),
      'canvas-session'
    );
    engine.stop();
    wal.destroy();
    live.cleanup();
    unsubscribeManager();
    stopValidation();
    listeners.clear();
    fireAndForget(close(), 'canvas-session');
  });
  return {
    state,
    pending: () => pending() || appends() > 0,
    failure,
    flush,
    retrySave,
    status: live.status,
    awareness,
    peerId: manager.peerIdStr,
    finishEditing: (finish: () => void) => {
      finishEdits = finish;
    },
  };
}
export type CanvasSession = ReturnType<typeof createCanvasSession>;
