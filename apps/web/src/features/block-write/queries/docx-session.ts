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
import type { LoroDoc } from 'loro-crdt';
import { errAsync, type ResultAsync } from 'neverthrow';
import { type Accessor, createSignal, onCleanup } from 'solid-js';
import { match } from 'ts-pattern';
import {
  DOCX_FORMAT_VERSION,
  docxFormatVersion,
  isDocxSeeded,
} from '../core/docx-loro';
import { DOCX_LORO_SCHEMA } from '../core/docx-loro-schema';

/** Where a collaborator's caret is: a paragraph and an offset in its text. */
export type DocxSelection = { block: string; offset: number };

export type DocxPeer = {
  userId: string | undefined;
  color: string;
  peerId: string;
  selection: DocxSelection;
};

export type DocxSessionState =
  | { t: 'loading' }
  | { t: 'ready'; doc: LoroDoc }
  /** The uploaded file, read-only, before anyone with edit access opened it. */
  | { t: 'original'; bytes: Uint8Array }
  | { t: 'error'; message: string };

export type DocxConnection = {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, SyncError>;
};

export type DocxSessionOptions = {
  documentId: string;
  userId?: string;
  canEdit: Accessor<boolean>;
  canComment: Accessor<boolean>;
  /** Whether the sync service already holds this document. */
  exists: () => Promise<boolean>;
  /** The uploaded DOCX, used to seed and as a read-only fallback. */
  fetchOriginal: () => Promise<Uint8Array>;
  /** The first collaborative snapshot for the original. */
  buildSeed: (original: Uint8Array) => Promise<Uint8Array>;
  /** Store the first snapshot. Rejects when it could not be stored. */
  initialize: (snapshot: Uint8Array) => Promise<void>;
  /** Open the live transport. Called once, after the document exists. */
  connect: () => DocxConnection;
  persistence?: {
    snapshots: SnapshotStore<Uint8Array>;
    wal: WALStore<Uint8Array>;
    makeChatter?: (documentId: string) => Chatter;
  };
};

export type DocxSession = {
  state: Accessor<DocxSessionState>;
  status: Accessor<'connected' | 'offline' | 'connecting'>;
  peers: Accessor<DocxPeer[]>;
  setSelection: (selection: DocxSelection | undefined) => void;
  /** Called after remote changes were merged into the document. */
  onRemoteChange: (listener: () => void) => () => void;
};

function isSelection(value: unknown): value is DocxSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'block' in value &&
    typeof value.block === 'string' &&
    'offset' in value &&
    typeof value.offset === 'number'
  );
}

/**
 * The collaborative DOCX on the shared sync stack: a Loro document with a
 * local snapshot, write-ahead log, live transport and presence, seeded from
 * the uploaded file the first time someone with edit access opens it.
 */
export function createDocxSession(options: DocxSessionOptions): DocxSession {
  const manager = new LoroManager(DOCX_LORO_SCHEMA, {
    documentId: options.documentId,
    // The editor reads the document directly; a JSON mirror of it would be
    // rebuilt on every keystroke.
    mirror: false,
  });
  const snapshots =
    options.persistence?.snapshots ??
    new IDBSnapshotStore<Uint8Array>(LORO_SNAPSHOT_DB_NAME, options.documentId);
  const walStore =
    options.persistence?.wal ??
    new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, options.documentId);
  const [state, setState] = createSignal<DocxSessionState>({ t: 'loading' });
  const [connection, setConnection] = createSignal<DocxConnection>();
  const listeners = new Set<() => void>();
  let disposed = false;
  let started = false;

  const wal = new WALSyncer(
    walStore,
    (updates) =>
      connection()?.source.pushUpdate(updates) ?? Promise.resolve(false),
    options.documentId
  );

  const awareness = createAwareness<DocxSelection, DocxSelection>(
    manager.peerIdStr,
    options.userId,
    {
      encode: (selection) => selection,
      decode: (selection) =>
        isSelection(selection) ? selection : { block: '', offset: 0 },
    }
  );
  let selection: DocxSelection | undefined;
  // Awareness expires; keep an idle caret visible while connected.
  const heartbeat = setInterval(() => {
    if (
      selection &&
      connection()?.source.status() === SyncSourceStatus.Connected
    )
      awareness.updateLocalAwareness(selection);
  }, 3_000);

  const notify = () => {
    for (const listener of listeners) listener();
  };

  // The engine starts before the transport exists when a cached copy opens
  // offline-first, so it talks to a source that forwards to the connection
  // once there is one.
  const liveListeners = new Set<(event: SyncSourceEvent) => void>();
  let peerId: bigint | undefined;
  const notConnected = () => errAsync(SyncError.connectionFailed());
  const live: LiveSyncSource = {
    documentId: options.documentId,
    status: () => connection()?.source.status() ?? SyncSourceStatus.Connecting,
    listen: (listener) => {
      liveListeners.add(listener);
      return () => liveListeners.delete(listener);
    },
    pushUpdate: (updates) =>
      connection()?.source.pushUpdate(updates) ?? Promise.resolve(false),
    pushAwareness: (value) => connection()?.source.pushAwareness(value),
    registerPeerId: (value) => {
      peerId = value;
      connection()?.source.registerPeerId(value);
    },
    requestUpdatesSince: (version) =>
      connection()?.source.requestUpdatesSince(version) ?? notConnected(),
    requestSnapshot: () =>
      connection()?.source.requestSnapshot() ?? notConnected(),
    reconnect: () => connection()?.source.reconnect(),
    cleanup: () => connection()?.source.cleanup(),
  };

  const engine = createSyncEngine({
    loroManager: manager,
    awareness,
    syncs: { live, wal },
    bindings: { onRemoteState: notify },
    readonly: () => !options.canComment(),
    snapshotStore: snapshots,
    makeChatter: options.persistence?.makeChatter,
  });

  // The engine swaps its LoroDoc when it recovers from an invalid update.
  const unsubscribeManager = manager.onStateChange(() => {
    const current = state();
    if (current.t === 'ready' && current.doc !== manager.doc)
      setState({ t: 'ready', doc: manager.doc });
  });

  async function start() {
    if (disposed) return;
    const version = docxFormatVersion(manager.doc);
    if (version !== undefined && version > DOCX_FORMAT_VERSION) {
      setState({
        t: 'error',
        message: 'This document uses a newer format. Update Macro to open it.',
      });
      return;
    }
    if (!isDocxSeeded(manager.doc)) {
      setState({
        t: 'error',
        message: 'This document has no editable content.',
      });
      return;
    }
    if (!started) {
      // Persist the base before accepting edits so a crash can always replay
      // WAL entries against a valid snapshot.
      await snapshots.save(manager.doc.export({ mode: 'snapshot' }));
      if (disposed) return;
      engine.start();
      started = true;
    }
    setState({ t: 'ready', doc: manager.doc });
    if (options.canComment()) void wal.flush();
  }

  async function accept(initial: InitialSync) {
    if (initial.awareness.length)
      awareness.importRemoteAwareness(initial.awareness);
    const result = manager.initialized
      ? manager.importUpdate(initial.snapshot)
      : await manager.initializeFromSnapshot(initial.snapshot);
    if (disposed) return;
    // Changes that arrive ahead of their history wait in the document until
    // the sync engine's catch-up request brings the rest; only a copy with
    // nothing to show yet cannot go on without them.
    const failed = result.isErr()
      ? result.error.filter(
          (error) =>
            !manager.initialized ||
            error.code !== LoroManagerError.ImportPending
        )
      : [];
    if (failed.length) {
      console.error('DOCX snapshot import failed', failed);
      setState({ t: 'error', message: 'This document could not be opened.' });
      return;
    }
    if (started) notify();
    else await start();
  }

  async function seed(): Promise<boolean> {
    const original = await options.fetchOriginal();
    if (disposed) return false;
    if (!options.canEdit()) {
      setState({ t: 'original', bytes: original });
      return false;
    }
    const snapshot = await options.buildSeed(original);
    try {
      await options.initialize(snapshot);
    } catch (cause) {
      // Another editor may have initialized it first.
      if (!(await options.exists())) throw cause;
    }
    return true;
  }

  async function hydrate() {
    await wal.ready();
    const cached = await loadCachedState(manager, snapshots, walStore).catch(
      () => false
    );
    if (disposed) return;
    if (cached && isDocxSeeded(manager.doc)) await start();
    else if (!(await options.exists()) && !(await seed())) return;
    if (disposed) return;
    const opened = options.connect();
    setConnection(opened);
    opened.source.listen((event) => {
      for (const listener of liveListeners) listener(event);
      if (event.type === 'reconnect')
        accept(event)
          .then(() => wal.flush())
          .catch((cause: unknown) => {
            console.error('DOCX session failed to resync', cause);
            if (!disposed)
              setState({
                t: 'error',
                message: 'Unable to open this document.',
              });
          });
    });
    if (peerId !== undefined) opened.source.registerPeerId(peerId);
    const initial = await opened.doInitialSync();
    if (disposed) return;
    if (initial.isErr()) {
      if (!started)
        setState({
          t: 'error',
          message: 'Unable to connect to this document.',
        });
      return;
    }
    await accept(initial.value);
  }

  hydrate().catch((cause: unknown) => {
    console.error('DOCX session failed to open', cause);
    if (!disposed)
      setState({ t: 'error', message: 'Unable to open this document.' });
  });

  onCleanup(() => {
    disposed = true;
    clearInterval(heartbeat);
    unsubscribeManager();
    engine.stop();
    wal.destroy();
    connection()?.source.cleanup();
    listeners.clear();
    manager.dispose();
  });

  return {
    state,
    status: () =>
      match(connection()?.source.status())
        .with(SyncSourceStatus.Connected, () => 'connected' as const)
        .with(SyncSourceStatus.Disconnected, () => 'offline' as const)
        .otherwise(() => 'connecting' as const),
    peers: () =>
      awareness.remote().flatMap((peer) =>
        peer.selection?.block
          ? [
              {
                userId: peer.user.userId,
                color: peer.user.color,
                peerId: peer.user.peerId,
                selection: peer.selection,
              },
            ]
          : []
      ),
    setSelection: (next) => {
      selection = next;
      awareness.updateLocalAwareness(next);
    },
    onRemoteChange: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
