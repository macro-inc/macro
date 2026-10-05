/**
 * A form's layout shared by everyone editing it: the Loro document on the
 * sync stack, with a local snapshot, write-ahead log, live transport, and
 * presence. The server seeds the document; this session only edits it.
 * Once edits reach the server, the server is asked to publish the layout
 * respondents see, at most once per pause in editing.
 */

import { schema } from '@loro-mirror/core';
import { createAwareness } from '@macro-inc/collaboration/collab/awareness';
import type { Chatter } from '@macro-inc/collaboration/collab/chatter';
import { createSyncEngine } from '@macro-inc/collaboration/collab/engine';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
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
import type { FilterGroup } from '@service-storage/generated/schemas/filterGroup';
import type { FormLayout as WireFormLayout } from '@service-storage/generated/schemas/formLayout';
import type { FormSection } from '@service-storage/generated/schemas/formSection';
import { putFormLayoutBody } from '@service-storage/generated/zod';
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
import {
  applyLayout,
  LayoutDocumentError,
  readLayout,
} from '../core/collaboration-layout';
import { type FormSelection, isFormSelection } from '../core/form-presence';

/** Publication waits this long after the last delivered edit. */
const PUBLISH_DELAY_MS = 750;

/** Awareness expires on the server; an idle selection is sent again this often. */
const HEARTBEAT_MS = 3_000;

export type FormCollaborationState =
  | { kind: 'loading' }
  | { kind: 'ready' }
  | { kind: 'error'; message: string };

/** Whether the server holds every local edit. */
export type FormSaveState =
  | { kind: 'saved' }
  | { kind: 'saving' }
  /**
   * Edits wait: the last delivery was refused or never acknowledged, or the
   * local log refused them and they are held in memory only.
   */
  | { kind: 'unsaved'; reason: 'undelivered' | 'storage' };

export type FormConnectionStatus = 'connected' | 'connecting' | 'offline';

/** Why the published layout may not match the local one. */
export type FormFlushFailure =
  | { kind: 'not-ready' }
  | { kind: 'offline' }
  | { kind: 'unsaved'; pending: number }
  /** The local log failed; edits it refused are retried on the next flush. */
  | { kind: 'storage' }
  /** The server holds the edits but the layout is invalid. */
  | { kind: 'publication'; message: string }
  | { kind: 'publish-failed' };

export class FormFlushError extends Error {
  readonly failure: FormFlushFailure;

  constructor(failure: FormFlushFailure, options?: ErrorOptions) {
    super(`Form layout not published: ${failure.kind}`, options);
    this.name = 'FormFlushError';
    this.failure = failure;
  }
}

/** Another editor and what they selected. */
export type FormPeer = {
  peerId: string;
  userId: string | undefined;
  /** A palette color name. */
  color: string;
  selection: FormSelection;
};

export type FormConnection = {
  source: LiveSyncSource;
  doInitialSync: () => ResultAsync<InitialSync, SyncError>;
};

export type FormCollaborationOptions = {
  formId: string;
  userId?: string;
  /** Makes sure the server holds the form's seeded document. Called before connecting. */
  initialize: () => Promise<void>;
  /** Asks the server to publish the layout it holds. */
  publish: () => Promise<{ publicationError?: string }>;
  /** Opens the live transport, after `initialize`. */
  connect: () => FormConnection;
  persistence?: {
    snapshots: SnapshotStore<Uint8Array>;
    wal: WALStore<Uint8Array>;
    makeChatter?: (documentId: string) => Chatter;
  };
};

export type FormCollaborationSession = {
  state: Accessor<FormCollaborationState>;
  /** The last layout read from the document; kept while it is unreadable. */
  layout: Accessor<WireFormLayout | undefined>;
  save: Accessor<FormSaveState>;
  connection: Accessor<FormConnectionStatus>;
  /** Writes the edits from `previous` to `next`. Throws unless ready. */
  apply: (previous: WireFormLayout, next: WireFormLayout) => void;
  /**
   * Resolves once the server holds every local edit and has published them.
   * Rejects with a {@link FormFlushError} otherwise.
   */
  flush: () => Promise<void>;
  /** Why the server refused to publish the last layout it read. */
  publicationError: Accessor<string | undefined>;
  peers: Accessor<FormPeer[]>;
  setSelection: (selection: FormSelection | undefined) => void;
};

/**
 * The shared WAL, remembering the appends in flight: the engine appends
 * without waiting, so a flush must wait for them to land first. Edits the
 * store refuses stay in memory until a flush logs them again; neither a
 * refused append nor a failed flush rejects the engine's unawaited calls.
 */
class FormWAL extends WALSyncer<RawUpdate> {
  private readonly appending = new Set<Promise<void>>();
  private readonly unlogged: RawUpdate[] = [];
  private flushFailed = false;

  constructor(
    store: WALStore<RawUpdate>,
    push: (updates: RawUpdate[]) => Promise<boolean>,
    label: string,
    private readonly onChange: () => void
  ) {
    super(store, push, label);
  }

  override append(update: RawUpdate): Promise<void> {
    const appended = this.appendOrHold(update);
    this.appending.add(appended);
    void this.forget(appended);
    return appended;
  }

  override flush(): Promise<void> {
    return this.flushReporting();
  }

  get isAppending(): boolean {
    return this.appending.size > 0;
  }

  /** How many edits the store refused and only memory holds. */
  get unloggedCount(): number {
    return this.unlogged.length;
  }

  /** Whether the store refused an edit, or failed the last flush. */
  get storageFailed(): boolean {
    return this.unlogged.length > 0 || this.flushFailed;
  }

  /** Logs every edit, first those the store refused before; throws while it refuses. */
  async logged(): Promise<void> {
    while (this.appending.size > 0) await Promise.all(this.appending);
    for (
      let update = this.unlogged.shift();
      update;
      update = this.unlogged.shift()
    ) {
      try {
        await super.append(update);
      } catch (cause) {
        this.unlogged.unshift(update);
        throw cause;
      }
    }
  }

  /** Delivers the logged edits; throws when the store fails. */
  async deliver(): Promise<void> {
    try {
      await super.flush();
      this.flushFailed = false;
    } catch (cause) {
      this.flushFailed = true;
      throw cause;
    } finally {
      this.onChange();
    }
  }

  private async appendOrHold(update: RawUpdate): Promise<void> {
    try {
      await super.append(update);
    } catch (cause) {
      console.error('[forms] layout edit could not be logged', cause);
      this.unlogged.push(update);
      this.onChange();
    }
  }

  private async forget(appended: Promise<void>): Promise<void> {
    await appended;
    this.appending.delete(appended);
  }

  private async flushReporting(): Promise<void> {
    try {
      await this.deliver();
    } catch (cause) {
      console.error('[forms] layout log could not be delivered', cause);
    }
  }
}

type DecodedLayout =
  | { kind: 'layout'; layout: WireFormLayout }
  | { kind: 'invalid'; message: string };

const NEWER_VERSION = 'This form was edited by a newer version of Macro.';
const UNREADABLE = 'This form could not be opened.';

type SectionSchema =
  (typeof putFormLayoutBody.shape.sections.element.options)[number];
type GateSchema = Extract<SectionSchema, { shape: { rules: unknown } }>;

function isGateSchema(section: SectionSchema): section is GateSchema {
  return 'rules' in section.shape;
}

const gateSchema =
  putFormLayoutBody.shape.sections.element.options.find(isGateSchema);
if (!gateSchema) throw new Error('The form layout schema has no gate.');
/** A gate's rules; the generated schema leaves nested groups unchecked. */
const gateRules = gateSchema.shape.rules;

function isFilterGroup(value: unknown): value is FilterGroup {
  const parsed = gateRules.safeParse(value);
  return (
    parsed.success &&
    parsed.data.conditions.every(
      (node) => node.kind === 'condition' || isFilterGroup(node)
    )
  );
}

function decodeSections(value: unknown): FormSection[] | undefined {
  const parsed = putFormLayoutBody.safeParse(value);
  if (!parsed.success) return undefined;
  const sections: FormSection[] = [];
  for (const section of parsed.data.sections) {
    const decoded = match(section)
      .returnType<FormSection | undefined>()
      .with({ kind: 'questions' }, (questions) => questions)
      .with({ kind: 'booking' }, (booking) => booking)
      .with({ kind: 'gate' }, (gate) => {
        const { rules } = gate;
        return isFilterGroup(rules) ? { ...gate, rules } : undefined;
      })
      .exhaustive();
    if (!decoded) return undefined;
    sections.push(decoded);
  }
  return sections;
}

function decodeLayout(doc: LoroDoc): DecodedLayout {
  try {
    const sections = decodeSections(readLayout(doc));
    return sections
      ? { kind: 'layout', layout: { sections } }
      : { kind: 'invalid', message: NEWER_VERSION };
  } catch (cause) {
    if (!(cause instanceof LayoutDocumentError)) throw cause;
    return {
      kind: 'invalid',
      message: match(cause.problem)
        .with({ kind: 'unsupported-format' }, () => NEWER_VERSION)
        .otherwise(() => UNREADABLE),
    };
  }
}

export function createFormCollaborationSession(
  options: FormCollaborationOptions
): FormCollaborationSession {
  // The layout is read from the document itself, so no JSON mirror.
  const manager = new LoroManager(schema({}), {
    documentId: options.formId,
    mirror: false,
  });
  const snapshotStore =
    options.persistence?.snapshots ??
    new IDBSnapshotStore<Uint8Array>(LORO_SNAPSHOT_DB_NAME, options.formId);
  const walStore =
    options.persistence?.wal ??
    new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, options.formId);
  const [state, setState] = createSignal<FormCollaborationState>({
    kind: 'loading',
  });
  const [layout, setLayout] = createSignal<WireFormLayout>();
  const [save, setSave] = createSignal<FormSaveState>({ kind: 'saved' });
  const [publicationError, setPublicationError] = createSignal<string>();
  const [connection, setConnection] = createSignal<FormConnection>();
  const [reachable, setReachable] = createSignal(true);
  // The transport opens after async work; it still belongs to this owner.
  const owner = getOwner();
  let disposed = false;
  let started = false;
  /** Whether the server refused or never acknowledged the last delivery. */
  let refused = false;

  // A closed session must not save: the engine prunes the WAL after a save,
  // and the next session may already have loaded it.
  const snapshots: SnapshotStore<Uint8Array> = {
    load: () => snapshotStore.load(),
    save: async (snapshot) => {
      if (disposed) throw new Error('Form session closed before saving.');
      await snapshotStore.save(snapshot);
    },
    delete: () => snapshotStore.delete(),
  };

  async function push(updates: RawUpdate[]): Promise<boolean> {
    const source = connection()?.source;
    if (!source) return false;
    try {
      return await source.pushUpdate(updates);
    } catch (cause) {
      console.warn('[forms] layout delivery failed', cause);
      return false;
    }
  }

  async function deliver(updates: RawUpdate[]): Promise<boolean> {
    const delivered = await push(updates);
    refused = !delivered;
    if (delivered && !disposed) publishSoon();
    return delivered;
  }

  /** Reports whether the server holds every edit; returns how many wait. */
  async function reportSave(): Promise<number> {
    const { dirty } = await wal.summary();
    const pending = dirty + wal.unloggedCount;
    if (disposed) return pending;
    if (wal.storageFailed) setSave({ kind: 'unsaved', reason: 'storage' });
    else if (pending === 0 && !wal.isAppending) setSave({ kind: 'saved' });
    else if (refused) setSave({ kind: 'unsaved', reason: 'undelivered' });
    else setSave({ kind: 'saving' });
    return pending;
  }

  function storageError(cause: unknown): FormFlushError {
    if (!disposed) setSave({ kind: 'unsaved', reason: 'storage' });
    return new FormFlushError({ kind: 'storage' }, { cause });
  }

  async function reportSaveInBackground() {
    try {
      await reportSave();
    } catch (cause) {
      console.error('[forms] local layout log could not be read', cause);
      storageError(cause);
    }
  }

  const wal = new FormWAL(
    walStore,
    deliver,
    options.formId,
    () => void reportSaveInBackground()
  );

  let publishTimer: ReturnType<typeof setTimeout> | undefined;
  let publishing: Promise<void> | undefined;
  let queued: Promise<void> | undefined;

  async function publishOnce() {
    let result: { publicationError?: string };
    try {
      result = await options.publish();
    } catch (cause) {
      throw new FormFlushError({ kind: 'publish-failed' }, { cause });
    }
    if (disposed) return;
    setPublicationError(result.publicationError);
    if (result.publicationError !== undefined)
      throw new FormFlushError({
        kind: 'publication',
        message: result.publicationError,
      });
  }

  /** Publishes after the current publication, if any; callers meanwhile share it. */
  function publishNow(): Promise<void> {
    clearTimeout(publishTimer);
    publishTimer = undefined;
    queued ??= publishAfterCurrent();
    return queued;
  }

  async function publishAfterCurrent() {
    try {
      await publishing;
    } catch {
      // Its own caller reports it; this publication starts regardless.
    }
    queued = undefined;
    const current = publishOnce();
    publishing = current;
    try {
      await current;
    } finally {
      if (publishing === current) publishing = undefined;
    }
  }

  async function publishInBackground() {
    try {
      await publishNow();
    } catch (cause) {
      // Refusals show through `publicationError`.
      if (
        !(cause instanceof FormFlushError) ||
        cause.failure.kind !== 'publication'
      )
        console.warn('[forms] layout publication failed', cause);
    }
  }

  function publishSoon() {
    clearTimeout(publishTimer);
    publishTimer = setTimeout(
      () => void publishInBackground(),
      PUBLISH_DELAY_MS
    );
  }

  const awareness = createAwareness<FormSelection | null, FormSelection | null>(
    manager.peerIdStr,
    options.userId,
    {
      encode: (selection) => selection,
      decode: (selection) => (isFormSelection(selection) ? selection : null),
    }
  );
  let selection: FormSelection | undefined;
  const heartbeat = setInterval(() => {
    if (
      selection &&
      connection()?.source.status() === SyncSourceStatus.Connected
    )
      awareness.updateLocalAwareness(selection);
  }, HEARTBEAT_MS);

  // The engine starts before the transport exists when a cached copy opens
  // offline-first, so it talks to a source that forwards to the connection.
  const liveListeners = new Set<(event: SyncSourceEvent) => void>();
  let peerId: bigint | undefined;
  const notConnected = () => errAsync(SyncError.connectionFailed());
  const live: LiveSyncSource = {
    documentId: options.formId,
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
    // The layout is read from the document's own events.
    bindings: { onRemoteState: () => {} },
    readonly: () => false,
    snapshotStore: snapshots,
    makeChatter: options.persistence?.makeChatter,
  });

  function refresh() {
    const decoded = decodeLayout(manager.doc);
    if (decoded.kind === 'invalid') {
      setState({ kind: 'error', message: decoded.message });
      return;
    }
    setLayout(decoded.layout);
    if (state().kind !== 'ready') setState({ kind: 'ready' });
  }

  let unsubscribeDoc: (() => void) | undefined;
  function watch() {
    unsubscribeDoc?.();
    unsubscribeDoc = manager.doc.subscribe(refresh);
    refresh();
  }
  // The engine swaps its LoroDoc when it recovers from an invalid update.
  const unsubscribeManager = manager.onStateChange(() => {
    if (started) watch();
  });

  async function start() {
    if (disposed) return;
    if (!started) {
      // Persist the base before accepting edits so a crash can always replay
      // WAL entries against a valid snapshot.
      await snapshots.save(manager.doc.export({ mode: 'snapshot' }));
      if (disposed) return;
      engine.start();
      started = true;
      watch();
    }
    void wal.flush();
  }

  async function accept(initial: InitialSync) {
    if (initial.awareness.length)
      awareness.importRemoteAwareness(initial.awareness);
    const result = manager.initialized
      ? manager.importUpdate(initial.snapshot)
      : await manager.initializeFromSnapshot(initial.snapshot);
    if (disposed) return;
    if (result.isErr()) {
      setState({ kind: 'error', message: UNREADABLE });
      return;
    }
    await start();
  }

  /** Takes the server's state again after a reconnect. */
  async function resync(initial: InitialSync) {
    try {
      await accept(initial);
    } catch (cause) {
      console.error('[forms] collaboration failed to resync', cause);
      if (!disposed) setState({ kind: 'error', message: UNREADABLE });
    }
  }

  let unlisten: (() => void) | undefined;
  async function openConnection() {
    // The server seeds the document; never connect to one it has not.
    await options.initialize();
    if (disposed) return;
    const opened = runWithOwner(owner, () => options.connect());
    if (!opened) return;
    setConnection(opened);
    setReachable(true);
    unlisten = opened.source.listen((event) => {
      for (const listener of liveListeners) listener(event);
      if (event.type === 'reconnect') void resync(event);
    });
    if (peerId !== undefined) opened.source.registerPeerId(peerId);
    const initial = await opened.doInitialSync();
    if (disposed) return;
    if (initial.isErr()) {
      if (!started)
        setState({ kind: 'error', message: 'Unable to connect to this form.' });
      return;
    }
    await accept(initial.value);
  }

  let connecting: Promise<void> | undefined;
  /**
   * Connects once. A failure before the transport opened is retried by the
   * next flush, or when the browser comes back online.
   */
  function ensureConnected(): Promise<void> {
    connecting ??= connectOnce();
    return connecting;
  }

  async function connectOnce() {
    try {
      await openConnection();
    } catch (cause) {
      console.error('[forms] collaboration failed to connect', cause);
      if (disposed) return;
      if (!connection()) {
        connecting = undefined;
        setReachable(false);
      }
      if (!started)
        setState({ kind: 'error', message: 'Unable to connect to this form.' });
    }
  }

  const reconnectOnline = () => void ensureConnected();
  window.addEventListener('online', reconnectOnline);

  /** Whether the local copy opened the form; a failed read opens it from the server. */
  async function loadCache(): Promise<boolean> {
    try {
      return await loadCachedState(manager, snapshots, walStore);
    } catch (cause) {
      console.error('[forms] local form copy could not be read', cause);
      return false;
    }
  }

  async function hydrate() {
    await wal.ready();
    const cached = await loadCache();
    if (disposed) return;
    if (cached) await start();
    await ensureConnected();
  }

  async function openSession() {
    try {
      await hydrate();
    } catch (cause) {
      console.error('[forms] collaboration failed to open', cause);
      if (!disposed) setState({ kind: 'error', message: UNREADABLE });
    }
  }

  const opening = openSession();

  async function disposeOnceOpened() {
    // Opening may still read the document; free it once that settles.
    await opening;
    manager.dispose();
  }

  onCleanup(() => {
    disposed = true;
    window.removeEventListener('online', reconnectOnline);
    clearInterval(heartbeat);
    clearTimeout(publishTimer);
    unsubscribeDoc?.();
    unsubscribeManager();
    unlisten?.();
    engine.stop();
    wal.destroy();
    connection()?.source.cleanup();
    void disposeOnceOpened();
  });

  function apply(previous: WireFormLayout, next: WireFormLayout) {
    if (state().kind !== 'ready')
      throw new Error('The form layout is not open for editing.');
    applyLayout(manager.doc, previous, next);
    manager.doc.commit();
    if (wal.isAppending && !wal.storageFailed) setSave({ kind: 'saving' });
  }

  async function flush() {
    await opening;
    if (!connection()) await ensureConnected();
    if (state().kind !== 'ready')
      throw new FormFlushError({ kind: 'not-ready' });
    await logEdits();
    if (connection()?.source.status() !== SyncSourceStatus.Connected)
      throw new FormFlushError({ kind: 'offline' });
    const pending = await deliverEdits();
    if (pending > 0) throw new FormFlushError({ kind: 'unsaved', pending });
    await publishNow();
  }

  async function logEdits() {
    try {
      await wal.logged();
    } catch (cause) {
      throw storageError(cause);
    }
  }

  /** Delivers the logged edits; returns how many the server still lacks. */
  async function deliverEdits(): Promise<number> {
    try {
      await wal.deliver();
      return await reportSave();
    } catch (cause) {
      throw storageError(cause);
    }
  }

  return {
    state,
    layout,
    save,
    connection: () => {
      const source = connection()?.source;
      if (!source) return reachable() ? 'connecting' : 'offline';
      return match(source.status())
        .returnType<FormConnectionStatus>()
        .with(SyncSourceStatus.Connected, () => 'connected')
        .with(SyncSourceStatus.Disconnected, () => 'offline')
        .otherwise(() => 'connecting');
    },
    apply,
    flush,
    publicationError,
    peers: () =>
      awareness.remote().flatMap((peer) =>
        peer.selection
          ? [
              {
                peerId: peer.user.peerId,
                userId: peer.user.userId,
                color: peer.user.color,
                selection: peer.selection,
              },
            ]
          : []
      ),
    setSelection: (next) => {
      selection = next;
      // A cleared selection is sent as one, so peers drop it now rather than
      // when it expires.
      awareness.updateLocalAwareness(next ?? null);
    },
  };
}
