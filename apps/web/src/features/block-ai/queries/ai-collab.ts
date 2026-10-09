/**
 * A shared Illustrator document on the sync stack: a Loro document with a
 * local snapshot, write-ahead log, live transport, and presence. The first
 * person who can edit seeds it (an empty set of changes); the stored `.ai`
 * stays the base every person opens. This mirrors the Figma editor's
 * session (`block-fig/queries/fig-collab.ts`) with the document's own
 * maps and presence.
 */

import { schema } from '@loro-mirror/core';
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
import { LoroDoc } from 'loro-crdt';
import { errAsync, type ResultAsync } from 'neverthrow';
import {
  type Accessor,
  createSignal,
  getOwner,
  onCleanup,
  runWithOwner,
} from 'solid-js';
import { match } from 'ts-pattern';
import type { AiCollaboration } from '../context/ai-editor-context';
import {
  AI_CONTAINERS,
  AI_FORMAT_VERSION,
  documentFormat,
  seedDocument,
} from '../core/collab-entries';
import {
  type AiPeer,
  type AiPresence,
  isPresence,
  NOWHERE,
} from '../core/presence';

const strings = () =>
  schema.LoroMap({} as Record<string, ReturnType<typeof schema.String>>);

/** Mirror schema for the document's maps (see `AI_CONTAINERS`). */
const AI_LORO_SCHEMA = schema(
  Object.fromEntries(AI_CONTAINERS.map((name) => [name, strings()]))
);

/** Presence goes out at most this often while the pointer moves. */
const PRESENCE_INTERVAL_MS = 50;

/** Awareness expires on the server; idle presence is sent again this often. */
const HEARTBEAT_MS = 3_000;

/** How long storing a file waits for the sync service to have every change. */
const DELIVERY_TIMEOUT_MS = 5_000;

type AiCollabState =
  | { t: 'loading' }
  | { t: 'ready'; doc: LoroDoc }
  /** Nobody who can edit has opened it yet: show the stored file. */
  | { t: 'unshared' }
  | { t: 'error'; message: string };

export type AiConnection = {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, SyncError>;
};

export interface AiCollabOptions {
  documentId: string;
  userId?: string;
  canEdit: Accessor<boolean>;
  /** A display name for a user id. */
  displayName: (userId: string | undefined) => string;
  /** Whether the sync service already holds this document. */
  exists: () => Promise<boolean>;
  /** Stores the first snapshot. Rejects when it could not be stored. */
  initialize: (snapshot: Uint8Array) => Promise<void>;
  /** Opens the live transport. Called once, after the document exists. */
  connect: () => AiConnection;
  persistence?: {
    snapshots: SnapshotStore<Uint8Array>;
    wal: WALStore<Uint8Array>;
    makeChatter?: (documentId: string) => Chatter;
  };
}

export interface AiCollabSession {
  state: Accessor<AiCollabState>;
  collaboration: AiCollaboration;
  /**
   * Resolves once every change made here so far reached the sync service;
   * `false` when it could not be reached in time.
   */
  delivered: () => Promise<boolean>;
}

/** A write-ahead log that knows when the last local change was logged. */
class TrackedWALSyncer extends WALSyncer<Uint8Array> {
  /** Settles once the latest appended change is in the log. */
  lastAppend: Promise<unknown> = Promise.resolve();

  override append(update: Uint8Array): Promise<void> {
    const appended = super.append(update);
    this.lastAppend = settled(appended);
    return appended;
  }
}

/** Waits for a promise without failing when it does. */
async function settled(work: Promise<unknown>): Promise<void> {
  try {
    await work;
  } catch {
    // Only its end matters here.
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The first shared snapshot: the format version and nothing changed yet. */
function buildDocumentSeed(): Uint8Array {
  const doc = new LoroDoc();
  seedDocument(doc);
  return doc.export({ mode: 'snapshot' });
}

export function createAiCollabSession(
  options: AiCollabOptions
): AiCollabSession {
  const manager = new LoroManager(AI_LORO_SCHEMA, {
    documentId: options.documentId,
  });
  const snapshots =
    options.persistence?.snapshots ??
    new IDBSnapshotStore<Uint8Array>(LORO_SNAPSHOT_DB_NAME, options.documentId);
  const walStore =
    options.persistence?.wal ??
    new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, options.documentId);
  const [state, setState] = createSignal<AiCollabState>({ t: 'loading' });
  const [connection, setConnection] = createSignal<AiConnection>();
  // The transport opens after async work; it still belongs to this owner.
  const owner = getOwner();
  let disposed = false;
  let started = false;

  const wal = new TrackedWALSyncer(
    walStore,
    (updates) =>
      connection()?.source.pushUpdate(updates) ?? Promise.resolve(false),
    options.documentId
  );

  const awareness = createAwareness<AiPresence, AiPresence>(
    manager.peerIdStr,
    options.userId,
    {
      encode: (presence) => presence,
      decode: (presence) => (isPresence(presence) ? presence : NOWHERE),
    }
  );
  let presence: AiPresence | undefined;
  let presenceTimer: ReturnType<typeof setTimeout> | undefined;
  let lastSent = 0;
  const sendPresence = () => {
    presenceTimer = undefined;
    lastSent = Date.now();
    awareness.updateLocalAwareness(presence ?? NOWHERE);
  };
  // Awareness expires; keep an idle presence visible while connected.
  const heartbeat = setInterval(() => {
    if (
      presence &&
      connection()?.source.status() === SyncSourceStatus.Connected
    )
      sendPresence();
  }, HEARTBEAT_MS);

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
    const version = documentFormat(manager.doc);
    if (version === undefined) {
      setState({ t: 'error', message: 'This document is empty.' });
      return;
    }
    if (version > AI_FORMAT_VERSION) {
      setState({
        t: 'error',
        message:
          'This document was edited by a newer version of Macro. Reload to open it.',
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
      setState({ t: 'error', message: 'This document could not be shared.' });
      return;
    }
    if (!started) await start();
  }

  /** Seeds the shared document; `false` when this viewer can't. */
  async function seed(): Promise<boolean> {
    if (!options.canEdit()) {
      setState({ t: 'unshared' });
      return false;
    }
    try {
      await options.initialize(buildDocumentSeed());
    } catch (cause) {
      // Another editor may have seeded it first.
      if (!(await options.exists())) throw cause;
    }
    return true;
  }

  /** A copy cached by an earlier visit, when it is usable. */
  async function cachedCopy(): Promise<boolean> {
    try {
      return await loadCachedState(manager, snapshots, walStore);
    } catch {
      return false;
    }
  }

  async function hydrate() {
    await wal.ready();
    const cached = await cachedCopy();
    if (disposed) return;
    if (cached && documentFormat(manager.doc) !== undefined) await start();
    else if (!(await options.exists()) && !(await seed())) return;
    if (disposed) return;
    const opened = runWithOwner(owner, () => options.connect());
    if (!opened) return;
    setConnection(opened);
    opened.source.listen((event) => {
      for (const listener of liveListeners) listener(event);
      if (event.type === 'reconnect') void resync(event);
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

  /** Takes the server's state again after a reconnect. */
  async function resync(initial: InitialSync) {
    try {
      await accept(initial);
      await wal.flush();
    } catch (cause) {
      console.error('[ai] collaboration failed to resync', cause);
      if (!disposed)
        setState({ t: 'error', message: 'This document could not be shared.' });
    }
  }

  async function open() {
    try {
      await hydrate();
    } catch (cause) {
      console.error('[ai] collaboration failed to open', cause);
      if (!disposed)
        setState({ t: 'error', message: 'Unable to share this document.' });
    }
  }
  void open();

  onCleanup(() => {
    disposed = true;
    clearInterval(heartbeat);
    clearTimeout(presenceTimer);
    unsubscribeManager();
    engine.stop();
    wal.destroy();
    connection()?.source.cleanup();
    manager.dispose();
  });

  const peers = (): AiPeer[] =>
    awareness.remote().flatMap((peer) =>
      peer.selection && peer.selection.session > 0
        ? [
            {
              peerId: peer.user.peerId,
              userId: peer.user.userId,
              name: options.displayName(peer.user.userId),
              color: peer.user.color,
              presence: peer.selection,
            },
          ]
        : []
    );

  async function delivered(): Promise<boolean> {
    const deadline = Date.now() + DELIVERY_TIMEOUT_MS;
    // A commit logs its change at once; the log writes it asynchronously.
    await wal.lastAppend;
    while (!disposed) {
      if (connection()?.source.status() === SyncSourceStatus.Connected) {
        await wal.flush();
        if ((await wal.summary()).dirty === 0) return true;
      }
      if (Date.now() >= deadline) return false;
      await sleep(200);
    }
    return false;
  }

  return {
    state,
    delivered,
    collaboration: {
      peerId: manager.peerIdStr,
      color: () => awareness.local().user.color,
      peers,
      setPresence: (next) => {
        presence = next;
        // Pointer moves are frequent: send at most one per interval.
        if (presenceTimer !== undefined) return;
        const wait = PRESENCE_INTERVAL_MS - (Date.now() - lastSent);
        if (wait <= 0) sendPresence();
        else presenceTimer = setTimeout(sendPresence, wait);
      },
      status: () =>
        match(connection()?.source.status())
          .with(SyncSourceStatus.Connected, () => 'connected' as const)
          .with(SyncSourceStatus.Disconnected, () => 'offline' as const)
          .otherwise(() => 'connecting' as const),
    },
  };
}
