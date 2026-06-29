import type { InferType } from '@loro-mirror/packages/core/src';
import type { SerializedEditorState } from 'lexical';
import { SyncEngine } from '../../app/packages/core/collab/engine';
import type { LoroManager } from '../../app/packages/core/collab/manager';
import type { RawUpdate } from '../../app/packages/core/collab/shared';
import type { WALSyncer } from '../../app/packages/core/collab/wal';
import type { SyncServiceSource } from '../../app/packages/service-clients/service-sync/source/source';
import {
  MARKDOWN_LORO_SCHEMA,
  type MarkdownLoroSchemaType,
} from '../../lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '../../lexical-core/plugins/nodeIdPlugin';
import {
  createEditingSession,
  loadSnapshot,
  type LexicalSession,
  toSnapshot,
} from './ai-editing/ai-toolkit';
import {
  nextAiPeerId,
  type AwarenessSource,
  type Peer,
  PeerPool,
  realAwarenessSource,
  sharedPeerPool,
} from './ai-editing/awareness';
import { Doc } from './ai-editing/doc';
import type { Awareness } from './ai-editing/queue';
import type { Writer } from './ai-editing/tools';
import type { ReplayEvent, ReplayTrace } from './replay-trace';
import { createWorkerAwareness } from './sources';

export type EditingWorkspaceOptions = {
  pool?: PeerPool;
  /** Record every applied op + cursor move into a replayable trace (debug only). */
  record?: boolean;
};

export class EditingWorkspace {
  readonly session: LexicalSession;
  private readonly engine: SyncEngine<typeof MARKDOWN_LORO_SCHEMA, unknown>;
  private chain: Promise<void> = Promise.resolve();
  private readonly outstanding = new Map<Peer, AwarenessSource>();
  private readonly pool: PeerPool;
  private readonly record: boolean;
  /** The document before any AI edits — replay applies the log against this. */
  private readonly initialState: SerializedEditorState;
  private readonly recording: ReplayEvent[] = [];
  private readonly startedAt = Date.now();

  constructor(
    private readonly manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>,
    private readonly source: SyncServiceSource,
    wal: WALSyncer<RawUpdate>,
    opts: EditingWorkspaceOptions = {}
  ) {
    this.pool = opts.pool ?? sharedPeerPool;
    this.record = opts.record ?? false;
    // Seed the editing surface from the merged state.
    this.session = createEditingSession();
    loadSnapshot(
      this.session,
      manager.mirror!.getState() as unknown as SerializedEditorState
    );
    this.initialState = toSnapshot(this.session);

    this.engine = new SyncEngine({
      loroManager: manager,
      awareness: createWorkerAwareness(manager.peerIdStr),
      syncs: { wal, live: source },
      bindings: {
        // Inbound: a remote (human) edit landed — fold it into the AI's session
        // so its next diff is a clean delta and the user's text is preserved.
        onRemoteState: (state) =>
          loadSnapshot(
            this.session,
            state as unknown as SerializedEditorState
          ),
      },
    });

    // Feed the manager's state changes into the engine, deferred to a microtask:
    // loro fires the mirror subscriber synchronously during `importUpdate`, and
    // the engine guards remote handling with a mutex — calling `onStateUpdate`
    // inline would re-enter that lock. (The browser gets this deferral for free
    // via a Solid effect; here we do it by hand.)
    manager.onStateChange((u) =>
      queueMicrotask(() => this.engine.onStateUpdate(u))
    );
    this.engine.start();
  }

  /** Borrow a writer: its own `Doc` (authoring under a pooled peer) + cursor.
   *  `release` (on the returned writer) clears the cursor and returns the peer. */
  async borrowWriter(): Promise<Writer> {
    const peer = await this.pool.borrow();
    const realDoc = new Doc(this.session, () => this.propagate(peer.peerId));
    const realAwareness = realAwarenessSource({
      mirror: this.manager.mirror!,
      doc: this.manager.doc,
      send: (bytes) => this.source.pushAwareness(bytes),
      name: peer.name,
      color: peer.color,
    });
    const doc = this.record ? this.recordDoc(realDoc, peer) : realDoc;
    const awarenessSource = this.record
      ? this.recordAwareness(realAwareness, peer)
      : realAwareness;
    this.outstanding.set(peer, awarenessSource);
    const release = () => {
      if (!this.outstanding.delete(peer)) return;
      awarenessSource.clear();
      this.pool.release(peer);
    };
    return { doc, awarenessSource, release };
  }

  /** The captured replay trace (empty unless constructed with `record: true`). */
  replay(): ReplayTrace {
    return { initial: this.initialState, events: this.recording };
  }

  /** Wrap a writer's `Doc` so every applied op is logged, tagged with its peer.
   *  A Proxy keeps all the `DocReader` methods (textLength/locate/…) intact for
   *  the animator, intercepting only `apply`. */
  private recordDoc(doc: Doc, peer: Peer): Doc {
    const log = (op: Parameters<Doc['apply']>[0]) =>
      this.recording.push({
        t: Date.now() - this.startedAt,
        peer: { name: peer.name, color: peer.color },
        kind: 'edit',
        op,
      });
    return new Proxy(doc, {
      get(target, prop, recv) {
        if (prop === 'apply') {
          return (op: Parameters<Doc['apply']>[0]) => {
            log(op);
            return target.apply(op);
          };
        }
        const v = Reflect.get(target, prop, recv);
        return typeof v === 'function' ? v.bind(target) : v;
      },
    });
  }

  /** Wrap a writer's awareness source so each cursor move + clear is logged. */
  private recordAwareness(
    source: AwarenessSource,
    peer: Peer
  ): AwarenessSource {
    const p = { name: peer.name, color: peer.color };
    return {
      apply: (x: Awareness) => {
        this.recording.push({ t: Date.now() - this.startedAt, peer: p, kind: 'awareness', x });
        source.apply(x);
      },
      clear: () => {
        this.recording.push({ t: Date.now() - this.startedAt, peer: p, kind: 'clear' });
        source.clear();
      },
    };
  }

  /** Perform one final catch-all sync and wait for all queued propagation to finish. */
  flush(): Promise<void> {
    this.propagate(nextAiPeerId());
    return this.chain;
  }

  /** Stop syncing and release any writers still outstanding. */
  dispose(): void {
    this.engine.stop();
    for (const [peer, awarenessSource] of this.outstanding) {
      awarenessSource.clear();
      this.pool.release(peer);
    }
    this.outstanding.clear();
  }

  private propagate(peerId: bigint): void {
    this.chain = this.chain.then(async () => {
      this.manager.doc.commit();
      this.manager.doc.setPeerId(peerId);
      this.source.registerPeerId(peerId);

      // Prism creates code-highlight nodes without ids (skipTransforms). Stamp
      // ids before snapshotting so the Loro mirror matches them by id instead of
      // re-inserting duplicates on every sync. (code block thing :/)
      this.session.editor.update(() => $updateAllNodeIds(this.session.ids), {
        discrete: true,
      });

      const snapshot = toSnapshot(this.session);
      await this.engine.syncStateToLoro(
        snapshot as unknown as InferType<MarkdownLoroSchemaType>
      );
    });
  }
}
