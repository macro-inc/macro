import { schema } from '@loro-mirror/core';
import { createAwareness } from '@macro-inc/collaboration/collab/awareness';
import type {
  Chatter,
  ChatterMessage,
} from '@macro-inc/collaboration/collab/chatter';
import { SyncEngine } from '@macro-inc/collaboration/collab/engine';
import { LoroManager } from '@macro-inc/collaboration/collab/manager';
import {
  IDBSnapshotStore,
  LORO_SNAPSHOT_DB_NAME,
  type SnapshotStore,
} from '@macro-inc/collaboration/collab/snapshot-store';
import {
  BrowserWALStore,
  InMemoryWALStore,
  LORO_WAL_DB_NAME,
  type WALEntry,
  type WALStore,
  WALSyncer,
} from '@macro-inc/collaboration/collab/wal';
import { createSyncSocket } from '@macro-inc/collaboration/sync-service/socket';
import { SyncServiceSource } from '@macro-inc/collaboration/sync-service/source';
import type { PeerCommand, PeerFinal, PeerWalRow } from './generated';
import { Activity, clock, WALL_ORIGIN } from './runtime';
import { effects, transports } from './transport';

export const activity = new Activity();
class ObservedStore implements WALStore<Uint8Array> {
  constructor(private readonly inner: WALStore<Uint8Array>) {}
  append(update: Uint8Array) {
    return activity.observe(this.inner.append(update));
  }
  getAll(): Promise<WALEntry<Uint8Array>[]> {
    return activity.observe(this.inner.getAll());
  }
  markDelivered(ids: number[]) {
    return activity.observe(this.inner.markDelivered(ids));
  }
  pruneDelivered() {
    return activity.observe(this.inner.pruneDelivered());
  }
  pruneExpired(ttl: number) {
    return activity.observe(this.inner.pruneExpired(ttl));
  }
  count() {
    return activity.observe(this.inner.count());
  }
}
class ObservedSnapshots implements SnapshotStore<Uint8Array> {
  constructor(private readonly inner: SnapshotStore<Uint8Array>) {}
  load() {
    return activity.observe(this.inner.load());
  }
  save(bytes: Uint8Array) {
    return activity.observe(this.inner.save(bytes));
  }
  delete() {
    return activity.observe(this.inner.delete());
  }
}
const formSchema = schema({
  fields: schema.LoroMap({
    '0': schema.Number(),
    '1': schema.Number(),
    '2': schema.Number(),
    '3': schema.Number(),
    '4': schema.Number(),
    '5': schema.Number(),
    '6': schema.Number(),
    '7': schema.Number(),
  }),
  order: schema.LoroMovableList(schema.Number(), (value: number) =>
    String(value)
  ),
});
class SimChatter implements Chatter {
  private readonly listeners = new Set<(message: ChatterMessage) => void>();
  constructor(private readonly client: string) {}
  post(message: ChatterMessage): void {
    effects.push({
      type: 'chatter',
      client: this.client,
      awareness: message.type === 'awareness',
      bytes: Array.from(message.data),
    });
  }
  subscribe(listener: (message: ChatterMessage) => void) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  receive(message: ChatterMessage): void {
    for (const listener of this.listeners) listener(message);
  }
  close(): void {
    this.listeners.clear();
  }
}
function isPeerId(value: string): value is `${number}` {
  return /^\d+$/.test(value) && BigInt(value) <= 0xffff_ffff_ffff_ffffn;
}
class Peer {
  readonly manager: LoroManager<typeof formSchema>;
  readonly store: ObservedStore;
  readonly source: SyncServiceSource;
  readonly wal: WALSyncer<Uint8Array>;
  readonly engine: SyncEngine<typeof formSchema, number>;
  readonly chatter: SimChatter;
  alive = true;
  constructor(readonly config: Extract<PeerCommand, { type: 'open' }>) {
    this.manager = new LoroManager(formSchema, { documentId: config.document });
    if (!isPeerId(config.peer))
      throw new Error('peer identity is not a decimal u64');
    this.manager.doc.setPeerId(BigInt(config.peer));
    this.manager.doc.setRecordTimestamp(false);
    this.manager.doc.setChangeMergeInterval(0);
    const socket = createSyncSocket(
      () => `ws://sim.invalid/${encodeURIComponent(config.client)}`
    );
    let updateId = 0;
    this.source = new SyncServiceSource(socket, config.document, {
      newId: () => `${config.client}:${++updateId}`,
    });
    this.store = new ObservedStore(
      config.ai
        ? new InMemoryWALStore<Uint8Array>()
        : new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, config.document)
    );
    this.wal = new WALSyncer(
      this.store,
      (updates) => this.source.pushUpdate(updates),
      config.document
    );
    this.chatter = new SimChatter(config.client);
    const awareness = createAwareness<number, number>(config.peer, undefined, {
      encode: (value) => value,
      decode: (value) => value,
    });
    const snapshotStore = config.ai
      ? undefined
      : new ObservedSnapshots(
          new IDBSnapshotStore<Uint8Array>(
            LORO_SNAPSHOT_DB_NAME,
            config.document
          )
        );
    this.engine = new SyncEngine({
      loroManager: this.manager,
      awareness,
      syncs: { wal: this.wal, live: this.source },
      bindings: { onRemoteState: () => {} },
      readonly: () => config.readonly,
      snapshotStore,
      makeChatter: () => this.chatter,
    });
    void this.source.doInitialSync().then((result) => {
      if (result.isErr())
        throw new Error(`initial sync failed: ${result.error}`);
      return activity.observe(this.initialize(result.value.snapshot));
    });
  }
  private async initialize(snapshot: Uint8Array): Promise<void> {
    if (!this.alive) return;
    await this.manager.ingest({ kind: 'dss', snapshot });
    const rows = await this.store.getAll();
    for (const row of rows) {
      const imported = this.manager.importUpdate(row.update);
      if (imported.isErr())
        throw new Error(`WAL replay failed: ${JSON.stringify(imported.error)}`);
    }
    this.engine.start();
    void this.wal.flush();
  }
  async edit(field: number, value: number): Promise<void> {
    if (!this.manager.state?.state)
      throw new Error('edit before real manager initialization');
    this.manager.doc.setRecordTimestamp(false);
    this.manager.doc.setChangeMergeInterval(0);
    const state = this.manager.state.state;
    await this.engine.syncStateToLoro({
      ...state,
      fields: { ...state.fields, [field % 8]: value },
    });
  }
  async move(from: number, to: number): Promise<void> {
    if (!this.manager.state?.state)
      throw new Error('move before real manager initialization');
    const state = this.manager.state.state;
    const order = [...state.order];
    if (order.length === 0) return;
    const [value] = order.splice(from % order.length, 1);
    order.splice(to % (order.length + 1), 0, value);
    await this.engine.syncStateToLoro({ ...state, order });
  }
  crash(): void {
    this.alive = false;
    this.engine.stop();
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
      rows: rows.map((row) => {
        const owner: unknown = Reflect.get(row, 'owner');
        return {
          id: row.id,
          update: Array.from(row.update),
          delivered: row.delivered,
          created_at: String(row.createdAt),
          owner: typeof owner === 'string' ? owner : null,
        };
      }),
    };
  }
}
const peers = new Map<string, Peer>();
function peer(name: string): Peer {
  const result = peers.get(name);
  if (!result) throw new Error(`unknown peer ${name}`);
  return result;
}
export async function command(command: PeerCommand): Promise<void> {
  switch (command.type) {
    case 'open':
      if (peers.has(command.client))
        throw new Error('duplicate live peer identity');
      peers.set(command.client, new Peer(command));
      return;
    case 'tick':
      if (command.now + WALL_ORIGIN < clock.now)
        throw new Error('virtual time moved backwards');
      await clock.tickAsync(command.now + WALL_ORIGIN - clock.now);
      return;
    case 'frame':
      transports.get(command.client)?.receive(command.bytes);
      return;
    case 'text':
      transports.get(command.client)?.text(command.text);
      return;
    case 'edit':
      await peer(command.client).edit(command.field, command.value);
      return;
    case 'move':
      await peer(command.client).move(command.from, command.to);
      return;
    case 'chatter':
      peer(command.client).chatter.receive({
        type: command.awareness ? 'awareness' : 'update',
        data: Uint8Array.from(command.bytes),
      });
      return;
    case 'crash':
      peer(command.client).crash();
      return;
    case 'install_rows':
      await installRows(command.document, command.rows);
      return;
    case 'finals':
      return;
    case 'shutdown':
      for (const value of peers.values()) if (value.alive) value.crash();
      return;
  }
}
async function installRows(
  document: string,
  rows: PeerWalRow[]
): Promise<void> {
  // Use the shipping BrowserWALStore to create/open the v1 database; only the
  // adapter handoff writes the already committed rows with their original IDs.
  await new BrowserWALStore<Uint8Array>(LORO_WAL_DB_NAME, document).getAll();
  const database = await new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(LORO_WAL_DB_NAME, 1);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  const tx = database.transaction('updates', 'readwrite');
  const done = new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error);
  });
  for (const row of rows)
    tx.objectStore('updates').put({
      id: row.id,
      scopeId: document,
      update: Uint8Array.from(row.update),
      delivered: row.delivered,
      createdAt: Number(row.created_at),
      ...(row.owner === null ? {} : { owner: row.owner }),
    });
  await done;
  database.close();
}
export async function finals(): Promise<PeerFinal[]> {
  return Promise.all([...peers.values()].map((value) => value.final()));
}
