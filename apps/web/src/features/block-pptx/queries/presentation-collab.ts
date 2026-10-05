/**
 * A collaborative presentation on the shared sync stack: a Loro document
 * with a local snapshot, write-ahead log, live transport, and presence,
 * seeded from the stored `.pptx` the first time someone who can edit opens it.
 * The editor runs over it with `openCollaborativePresentation`.
 */

import { schema } from '@loro-mirror/core';
import type { SnapshotStore } from '@macro-inc/browser-store/snapshot-store';
import type { WALStore } from '@macro-inc/browser-store/wal-store';
import { createAwareness } from '@macro-inc/collaboration/collab/awareness';
import type { Chatter } from '@macro-inc/collaboration/collab/chatter';
import { createSyncEngine } from '@macro-inc/collaboration/collab/engine';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  createDocumentSnapshotStore,
  loadCachedState,
} from '@macro-inc/collaboration/collab/snapshot-store';
import {
  type InitialSync,
  type LiveSyncSource,
  SyncError,
  type SyncSourceEvent,
  SyncSourceStatus,
} from '@macro-inc/collaboration/collab/source';
import {
  createDocumentWALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import type { LoroDoc } from 'loro-crdt';
import { errAsync, type ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from 'solid-js';
import { match } from 'ts-pattern';
import type {
  PresentationCollaboration,
  PresentationPeer,
  PresentationSelection,
} from '../context/pptx-editor-context';
import {
  PPTX_CONTAINERS,
  PPTX_FORMAT_VERSION,
  presentationFormat,
} from '../core/collab-entries';

const strings = () =>
  schema.LoroMap({} as Record<string, ReturnType<typeof schema.String>>);

/** Mirror schema for the presentation maps (see `PPTX_CONTAINERS`). */
const PPTX_LORO_SCHEMA = schema(
  Object.fromEntries(PPTX_CONTAINERS.map((name) => [name, strings()]))
);

export type PresentationCollabState =
  | { t: 'loading' }
  | { t: 'ready'; doc: LoroDoc }
  /** Nobody who can edit has opened it yet: show the stored file. */
  | { t: 'unshared' }
  | { t: 'error'; message: string };

export type PresentationConnection = {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, SyncError>;
};

export interface PresentationCollabOptions {
  documentId: string;
  userId?: string;
  canEdit: Accessor<boolean>;
  /** A display name for a user id. */
  displayName: (userId: string | undefined) => string;
  /** Whether the sync service already holds this presentation. */
  exists: () => Promise<boolean>;
  /** The first shared snapshot, built from the stored file. */
  buildSeed: () => Promise<Uint8Array>;
  /** Stores the first snapshot. Rejects when it could not be stored. */
  initialize: (snapshot: Uint8Array) => Promise<void>;
  /** Opens the live transport. Called once, after the presentation exists. */
  connect: () => PresentationConnection;
  persistence?: {
    snapshots: SnapshotStore<Uint8Array>;
    wal: WALStore<Uint8Array>;
    makeChatter?: (documentId: string) => Chatter;
  };
}

export interface PresentationCollabSession {
  state: Accessor<PresentationCollabState>;
  collaboration: PresentationCollaboration;
}

function isSelection(value: unknown): value is PresentationSelection {
  return (
    typeof value === 'object' &&
    value !== null &&
    'slide' in value &&
    typeof value.slide === 'number' &&
    'shapes' in value &&
    Array.isArray(value.shapes)
  );
}

const NOWHERE: PresentationSelection = {
  slide: -1,
  shapes: [],
  editing: false,
};

export function createPresentationCollabSession(
  options: PresentationCollabOptions
): PresentationCollabSession {
  const manager = new LoroManager(PPTX_LORO_SCHEMA, {
    documentId: options.documentId,
  });
  const snapshots =
    options.persistence?.snapshots ??
    createDocumentSnapshotStore(options.documentId);
  const walStore =
    options.persistence?.wal ?? createDocumentWALStore(options.documentId);
  const [state, setState] = createSignal<PresentationCollabState>({
    t: 'loading',
  });
  const [connection, setConnection] = createSignal<PresentationConnection>();
  // The transport opens after async work; it still belongs to this owner.
  const owner = getOwner();
  let disposed = false;
  let started = false;

  const wal = new WALSyncer(
    walStore,
    (updates) =>
      connection()?.source.pushUpdate(updates) ?? Promise.resolve(false),
    options.documentId
  );

  const awareness = createAwareness<
    PresentationSelection,
    PresentationSelection
  >(manager.peerIdStr, options.userId, {
    encode: (selection) => selection,
    decode: (selection) => (isSelection(selection) ? selection : NOWHERE),
  });
  let selection: PresentationSelection | undefined;
  // Awareness expires; keep an idle presence visible while connected.
  const heartbeat = setInterval(() => {
    if (
      selection &&
      connection()?.source.status() === SyncSourceStatus.Connected
    )
      awareness.updateLocalAwareness(selection);
  }, 3_000);

  // The engine starts before the transport exists when a cached copy opens
  // offline-first, so it talks to a source that forwards to the connection.
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
    // The editor reads remote changes from the document's own events.
    bindings: { onRemoteState: () => {} },
    readonly: () => !options.canEdit(),
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
    const version = presentationFormat(manager.doc);
    if (version === undefined) {
      setState({ t: 'error', message: 'This presentation is empty.' });
      return;
    }
    if (version > PPTX_FORMAT_VERSION) {
      setState({
        t: 'error',
        message:
          'This presentation was saved by a newer version of Macro. Reload to open it.',
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
    if (options.canEdit()) void wal.flush();
  }

  async function accept(initial: InitialSync) {
    if (initial.awareness.length)
      awareness.importRemoteAwareness(initial.awareness);
    const result = manager.initialized
      ? manager.importUpdate(initial.snapshot)
      : await manager.initializeFromSnapshot(initial.snapshot);
    if (disposed) return;
    if (result.isErr()) {
      setState({
        t: 'error',
        message: 'This presentation could not be opened.',
      });
      return;
    }
    if (!started) await start();
  }

  /** Seeds the shared presentation; `false` when this viewer can't. */
  async function seed(): Promise<boolean> {
    if (!options.canEdit()) {
      setState({ t: 'unshared' });
      return false;
    }
    const snapshot = await options.buildSeed();
    if (disposed) return false;
    try {
      await options.initialize(snapshot);
    } catch (cause) {
      // Another editor may have seeded it first.
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
    if (cached && presentationFormat(manager.doc) !== undefined) await start();
    else if (!(await options.exists()) && !(await seed())) return;
    if (disposed) return;
    const opened = runWithOwner(owner, () => options.connect());
    if (!opened) return;
    setConnection(opened);
    opened.source.listen((event) => {
      for (const listener of liveListeners) listener(event);
      if (event.type === 'reconnect')
        accept(event)
          .then(() => wal.flush())
          .catch((cause: unknown) => {
            console.error('[pptx] collaboration failed to resync', cause);
            if (!disposed)
              setState({
                t: 'error',
                message: 'This presentation could not be opened.',
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
          message: 'Unable to connect to this presentation.',
        });
      return;
    }
    await accept(initial.value);
  }

  hydrate().catch((cause: unknown) => {
    console.error('[pptx] collaboration failed to open', cause);
    if (!disposed)
      setState({ t: 'error', message: 'Unable to open this presentation.' });
  });

  onCleanup(() => {
    disposed = true;
    clearInterval(heartbeat);
    unsubscribeManager();
    engine.stop();
    wal.destroy();
    connection()?.source.cleanup();
    manager.dispose();
  });

  const peers = (): PresentationPeer[] =>
    awareness.remote().flatMap((peer) =>
      peer.selection && peer.selection.slide >= 0
        ? [
            {
              peerId: peer.user.peerId,
              userId: peer.user.userId,
              name: options.displayName(peer.user.userId),
              color: peer.user.color,
              selection: peer.selection,
            },
          ]
        : []
    );

  return {
    state,
    collaboration: {
      peers,
      setSelection: (next) => {
        selection = next;
        awareness.updateLocalAwareness(next ?? NOWHERE);
      },
      status: () =>
        match(connection()?.source.status())
          .with(SyncSourceStatus.Connected, () => 'connected' as const)
          .with(SyncSourceStatus.Disconnected, () => 'offline' as const)
          .otherwise(() => 'connecting' as const),
    },
  };
}
