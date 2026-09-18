import { createAwareness } from '@macro-inc/collaboration/collab/awareness';
import type { Chatter } from '@macro-inc/collaboration/collab/chatter';
import { createSyncEngine } from '@macro-inc/collaboration/collab/engine';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
  loadCachedState,
  type SnapshotStore,
} from '@macro-inc/collaboration/collab/snapshot-store';
import {
  type InitialSync,
  type LiveSyncSource,
  SyncSourceStatus,
  type TimeoutError,
} from '@macro-inc/collaboration/collab/source';
import {
  BrowserWALStore,
  LORO_WAL_DB_NAME,
  type WALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { LoroDoc } from 'loro-crdt';
import type { ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import type { SpreadsheetDocumentSource } from '../context/spreadsheet-source';
import {
  DEFAULT_SHEET_ID,
  parseCellAddress,
  SPREADSHEET_FORMAT_VERSION,
  type SpreadsheetSelection,
} from '../core/spreadsheet-document';
import { SPREADSHEET_LORO_SCHEMA } from '../core/spreadsheet-schema';
import { isSpreadsheetSheetId } from '../core/workbook-document';

export type SpreadsheetSessionOptions = {
  documentId: string;
  userId?: string;
  canEdit: Accessor<boolean>;
  syncSource: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, TimeoutError>;
};

// Snapshot stores for successive mounts share one IndexedDB key. Finish an
// already-started write before a new mount reads; never let a disposed session
// start another write after its replacement has hydrated.
const snapshotOperations = new Map<string, Promise<void>>();

function serializeSnapshotOperation<T>(
  documentId: string,
  operation: () => Promise<T>
): Promise<T> {
  const pending = (
    snapshotOperations.get(documentId) ?? Promise.resolve()
  ).then(operation);
  const settled = pending.then(
    () => {},
    () => {}
  );
  snapshotOperations.set(documentId, settled);
  void settled.then(() => {
    if (snapshotOperations.get(documentId) === settled)
      snapshotOperations.delete(documentId);
  });
  return pending;
}

/** The same Loro, local snapshot, WAL and live transport used by markdown. */
export function createSpreadsheetSession(
  options: SpreadsheetSessionOptions,
  persistence?: {
    snapshots: SnapshotStore<Uint8Array>;
    wal: WALStore<Uint8Array>;
    makeChatter?: (documentId: string) => Chatter;
  }
): SpreadsheetDocumentSource {
  const manager = new LoroManager(SPREADSHEET_LORO_SCHEMA, {
    documentId: options.documentId,
  });
  const snapshotStore =
    persistence?.snapshots ??
    new IDBSnapshotStore<Uint8Array>(LORO_SNAPSHOT_DB_NAME, options.documentId);
  const walStore =
    persistence?.wal ??
    new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, options.documentId);
  const wal = new WALSyncer(
    walStore,
    (updates) => options.syncSource.pushUpdate(updates),
    options.documentId
  );
  const [doc, setDoc] = createSignal<LoroDoc>();
  const [ready, setReady] = createSignal(false);
  const [error, setError] = createSignal<string>();
  let disposed = false;
  const snapshots: SnapshotStore<Uint8Array> = {
    load: () =>
      serializeSnapshotOperation(options.documentId, () =>
        disposed ? Promise.resolve(null) : snapshotStore.load()
      ),
    save: (snapshot) =>
      serializeSnapshotOperation(options.documentId, () => {
        // Reject rather than report success: the engine must not prune WAL entries
        // when this session no longer owns a snapshot write.
        if (disposed)
          throw new Error('Spreadsheet session closed before snapshot save.');
        return snapshotStore.save(snapshot);
      }),
    delete: () =>
      serializeSnapshotOperation(options.documentId, () =>
        disposed ? Promise.resolve() : snapshotStore.delete()
      ),
  };

  async function preparePersistence(): Promise<boolean> {
    try {
      await wal.ready();
      return true;
    } catch (cause) {
      console.error('Spreadsheet local storage could not be opened', cause);
      if (!disposed)
        setError(
          'Local storage is unavailable. Reopen this spreadsheet to try again.'
        );
      return false;
    }
  }
  const persistenceReady = preparePersistence();

  const awareness = createAwareness<SpreadsheetSelection, SpreadsheetSelection>(
    manager.peerIdStr,
    options.userId,
    {
      encode: (selection) => selection,
      decode: (selection) => ({
        sheetId: isSpreadsheetSheetId(selection.sheetId)
          ? selection.sheetId
          : DEFAULT_SHEET_ID,
        anchor: parseCellAddress(selection.anchor) ? selection.anchor : 'A1',
        focus: parseCellAddress(selection.focus) ? selection.focus : 'A1',
      }),
    }
  );
  // Awareness expires after ten seconds. Keep an idle selection visible while
  // connected, but let disconnected clients disappear from everyone else's grid.
  let selection: SpreadsheetSelection | undefined;
  const presenceHeartbeat = setInterval(() => {
    if (
      ready() &&
      selection &&
      options.syncSource.status() === SyncSourceStatus.Connected
    )
      awareness.updateLocalAwareness(selection);
  }, 3_000);
  onCleanup(() => clearInterval(presenceHeartbeat));

  const engine = createSyncEngine({
    loroManager: manager,
    awareness,
    syncs: { live: options.syncSource, wal },
    bindings: { onRemoteState: () => setDoc(manager.doc) },
    readonly: () => !options.canEdit(),
    snapshotStore: snapshots,
    makeChatter: persistence?.makeChatter,
  });

  // The shared engine replaces its LoroDoc when it recovers from an invalid
  // update. Initialization-tagged updates bypass its rendering binding, so
  // keep our document handle current independently of that binding.
  const unsubscribeManager = manager.onStateChange(() => {
    if (ready() && doc() !== manager.doc) setDoc(manager.doc);
  });

  async function saveSnapshot(): Promise<boolean> {
    if (!manager.initialized) return false;
    const snapshot = manager.doc.export({ mode: 'snapshot' });
    try {
      await snapshots.save(snapshot);
      return true;
    } catch (cause) {
      console.error('Spreadsheet local snapshot could not be saved', cause);
      return false;
    }
  }

  async function startEditor(): Promise<void> {
    const version = manager.doc.getMap('spreadsheetMeta').get('formatVersion');
    if (version !== undefined && version !== SPREADSHEET_FORMAT_VERSION) {
      setError(
        'This spreadsheet uses a newer format. Update Macro to open it.'
      );
      return;
    }
    // Persist the base before accepting edits so a crash can always replay
    // WAL entries against a valid snapshot on the next load.
    if (!(await persistenceReady) || disposed) return;
    if (!(await saveSnapshot())) {
      if (!disposed)
        setError(
          'Local storage is unavailable. Reopen this spreadsheet to try again.'
        );
      return;
    }
    if (disposed) return;
    engine.start();
    setDoc(manager.doc);
    setReady(true);
    setError(undefined);
    if (options.canEdit()) void wal.flush();
  }

  async function acceptSnapshot(initial: InitialSync): Promise<void> {
    if (initial.awareness.length)
      awareness.importRemoteAwareness(initial.awareness);
    if (manager.initialized) {
      const imported = manager.importUpdate(initial.snapshot);
      if (imported.isErr()) {
        setError('Unable to merge the latest spreadsheet changes.');
      } else {
        if (!ready()) await startEditor();
        else setError(undefined);
      }
      return;
    }
    const initialized = await manager.initializeFromSnapshot(initial.snapshot);
    if (disposed) return;
    if (initialized.isErr()) {
      setError('This spreadsheet could not be opened. Its data was preserved.');
      return;
    }
    await startEditor();
  }

  async function hydrate(): Promise<void> {
    // Begin network work immediately, but serialize snapshot ingestion to
    // avoid two competing seeds replacing each other's mirror or WAL replay.
    const remote = options.doInitialSync();
    try {
      const cached = await loadCachedState(manager, snapshots, walStore);
      if (disposed) return;
      if (cached) await startEditor();
    } catch (cause) {
      console.error('Spreadsheet local recovery failed', cause);
    }

    const initial = await remote;
    if (disposed) return;
    if (initial.isErr()) {
      setError(
        ready()
          ? 'Connection interrupted. Reconnecting…'
          : 'Unable to connect to this spreadsheet. Reconnecting…'
      );
      return;
    }
    await acceptSnapshot(initial.value);
  }

  async function initialize(): Promise<void> {
    try {
      await hydrate();
    } catch (cause) {
      console.error('Spreadsheet initialization failed', cause);
      if (!disposed) setError('Unable to open this spreadsheet.');
    }
  }
  const initialization = initialize();
  let recovery: Promise<void> | undefined;

  async function recoverConnection(initial: InitialSync): Promise<void> {
    try {
      await initialization;
      if (disposed) return;
      await acceptSnapshot(initial);
      if (!disposed && options.canEdit()) await wal.flush();
    } catch (cause) {
      console.error('Spreadsheet reconnection failed', cause);
      if (!disposed) setError('Unable to restore the spreadsheet connection.');
    } finally {
      recovery = undefined;
    }
  }

  const unsubscribe = options.syncSource.listen((event) => {
    if ((event.type === 'connect' || event.type === 'reconnect') && !recovery) {
      recovery = recoverConnection(event);
    }
  });

  async function disposeSession(): Promise<void> {
    await initialization;
    await recovery;
    // Local changes already enter the WAL. A final full snapshot captured by
    // this old session could overwrite the next session's newer recovery state.
    manager.dispose();
  }

  onCleanup(() => {
    disposed = true;
    unsubscribeManager();
    unsubscribe();
    engine.stop();
    wal.destroy();
    options.syncSource.cleanup();
    void disposeSession();
  });

  return {
    doc,
    ready,
    error,
    status: () =>
      match(options.syncSource.status())
        .with(SyncSourceStatus.Connected, () => 'connected' as const)
        .with(SyncSourceStatus.Disconnected, () => 'offline' as const)
        .otherwise(() => 'connecting' as const),
    peers: () =>
      awareness
        .remote()
        .flatMap((peer) =>
          peer.selection ? [{ ...peer.user, selection: peer.selection }] : []
        ),
    setSelection: (next) => {
      selection = next;
      awareness.updateLocalAwareness(next);
    },
  };
}
