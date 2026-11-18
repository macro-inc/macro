// The real shipping AI editor workspace owns bindings, synchronization and peer rotation.
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  InMemoryWALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import { MARKDOWN_LORO_SCHEMA } from '@macro-inc/lexical-core/markdown-loro-schema';
import { decodeImportBlobMeta } from 'loro-crdt';
import { toSnapshot } from '../../services/ai-editing-worker/src/ai-editing/ai-toolkit';
import { EditingWorkspace } from '../../services/ai-editing-worker/src/editing-workspace';
import { edit } from './editor-ops';
import type { EditorOp, PeerCommand, PeerFinal } from './generated';
import { activity } from './runtime';
import { ObservedStore } from './storage';
import { effects, transports } from './transport';

export class EditorPeer {
  readonly kind = 'editor';
  readonly manager: LoroManager<typeof MARKDOWN_LORO_SCHEMA>;
  readonly source: SyncServiceSource;
  readonly store: ObservedStore;
  readonly wal: WALSyncer<Uint8Array>;
  private workspace: EditingWorkspace | undefined;
  private readonly stopObserving: () => void;
  alive = true;
  constructor(readonly config: Extract<PeerCommand, { type: 'open_editor' }>) {
    if (
      !/^\d+$/.test(config.peer) ||
      BigInt(config.peer) > 0xffff_ffff_ffff_ffffn
    )
      throw new Error('peer identity is not a decimal u64');
    this.manager = new LoroManager(MARKDOWN_LORO_SCHEMA, {
      documentId: config.document,
    });
    this.manager.doc.setPeerId(BigInt(config.peer));
    this.manager.doc.setRecordTimestamp(false);
    this.manager.doc.setChangeMergeInterval(0);
    this.stopObserving = this.manager.doc.subscribeLocalUpdates((bytes) => {
      const metadata = decodeImportBlobMeta(bytes, true);
      const starts = metadata.partialStartVersionVector.toJSON();
      for (const [peer, end] of metadata.partialEndVersionVector.toJSON()) {
        const start = starts.get(peer) ?? 0;
        if (end > start)
          effects.push({
            type: 'commit',
            client: config.client,
            peer,
            start,
            end,
          });
      }
    });
    const socket = createSyncSocket(
      () => `ws://sim.invalid/${encodeURIComponent(config.client)}`
    );
    let updateId = 0;
    this.source = new SyncServiceSource(socket, config.document, {
      newId: () => `${config.client}:${++updateId}`,
    });
    this.store = new ObservedStore(new InMemoryWALStore<Uint8Array>());
    this.wal = new WALSyncer(
      this.store,
      (updates) => this.source.pushUpdate(updates),
      config.document
    );
    void this.source.doInitialSync().then((result) => {
      if (result.isErr())
        throw new Error(`editor initial sync failed: ${result.error}`);
      return activity.observe(this.initialize(result.value.snapshot));
    });
  }
  private async initialize(snapshot: Uint8Array): Promise<void> {
    if (!this.alive) return;
    await this.manager.ingest({ kind: 'dss', snapshot });
    for (const row of await this.store.getAll()) {
      const result = this.manager.importUpdate(row.update);
      if (result.isErr())
        throw new Error(
          `editor WAL import failed: ${JSON.stringify(result.error)}`
        );
    }
    this.workspace = new EditingWorkspace(this.manager, this.source, this.wal);
  }
  async edit(op: EditorOp): Promise<void> {
    const workspace = this.workspace;
    if (!workspace)
      throw new Error('edit before shipping workspace initialization');
    workspace.session.editor.update(() => edit(workspace.session, op), {
      discrete: true,
    });
    await workspace.flush();
  }
  crash(): void {
    this.alive = false;
    this.workspace?.dispose();
    this.stopObserving();
    this.wal.destroy();
    this.source.cleanup();
    transports.get(this.config.client)?.close();
  }
  async final(): Promise<PeerFinal> {
    const rows = await this.store.getAll();
    return {
      client: this.config.client,
      initialized: this.manager.initialized,
      vv: Object.fromEntries(this.manager.doc.oplogVersion().toJSON()),
      value_json: JSON.stringify(this.manager.doc.toJSON()),
      editor_json: this.workspace
        ? JSON.stringify(toSnapshot(this.workspace.session))
        : null,
      rows: rows.map((row) => ({
        id: row.id,
        update: Array.from(row.update),
        delivered: row.delivered,
        created_at: String(row.createdAt),
        owner: null,
      })),
    };
  }
}
