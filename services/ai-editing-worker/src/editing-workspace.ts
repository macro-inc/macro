import type { InferType } from '@loro-mirror/core';
import { SyncEngine } from '@macro-inc/collaboration/collab/engine';
import type { LoroManager } from '@macro-inc/collaboration/collab/manager';
import type { RawUpdate } from '@macro-inc/collaboration/collab/shared';
import type { WALSyncer } from '@macro-inc/collaboration/collab/wal';
import type { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import type {
  MARKDOWN_LORO_SCHEMA,
  MarkdownLoroSchemaType,
} from '@macro-inc/lexical-core/markdown-loro-schema';
import { $updateAllNodeIds } from '@macro-inc/lexical-core/plugins/nodeIdPlugin';
import type { SerializedEditorState } from 'lexical';
import {
  createEditingSession,
  type LexicalSession,
  loadSnapshot,
  toSnapshot,
} from './ai-editing/ai-toolkit';
import {
  type AwarenessSource,
  nextAiPeerId,
  type Peer,
  PeerPool,
  realAwarenessSource,
} from './ai-editing/awareness';
import { Doc } from './ai-editing/doc';
import type { Writer } from './ai-editing/tools';
import { createWorkerAwareness } from './sources';

export type EditingWorkspaceOptions = {
  pool?: PeerPool;
};

export class EditingWorkspace {
  readonly session: LexicalSession;
  private readonly engine: SyncEngine<typeof MARKDOWN_LORO_SCHEMA, unknown>;
  private chain: Promise<void> = Promise.resolve();
  private readonly outstanding = new Map<Peer, AwarenessSource>();
  private readonly pool: PeerPool;

  constructor(
    private readonly manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>,
    private readonly source: SyncServiceSource,
    wal: WALSyncer<RawUpdate>,
    opts: EditingWorkspaceOptions = {}
  ) {
    this.pool = opts.pool ?? new PeerPool();
    // Seed the editing surface from the merged state.
    this.session = createEditingSession();
    loadSnapshot(
      this.session,
      manager.mirror!.getState() as unknown as SerializedEditorState
    );

    this.engine = new SyncEngine({
      loroManager: manager,
      awareness: createWorkerAwareness(manager.peerIdStr),
      syncs: { wal, live: source },
      bindings: {
        // Inbound: a remote (human) edit landed — fold it into the AI's session
        // so its next diff is a clean delta and the user's text is preserved.
        onRemoteState: (state) =>
          loadSnapshot(this.session, state as unknown as SerializedEditorState),
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
    const doc = new Doc(this.session, () => this.propagate(peer.peerId));
    const awarenessSource = realAwarenessSource({
      mirror: this.manager.mirror!,
      doc: this.manager.doc,
      send: (bytes) => this.source.pushAwareness(bytes),
      name: peer.name,
      color: peer.color,
    });
    this.outstanding.set(peer, awarenessSource);
    const release = () => {
      if (!this.outstanding.delete(peer)) return;
      awarenessSource.clear();
      this.pool.release(peer);
    };
    return { doc, awarenessSource, release };
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
