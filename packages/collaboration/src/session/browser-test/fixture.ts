import { openDB } from 'idb';
import { type IStorageOpMsg, LocalStateMsg } from '../abi.generated';
import { SessionLease } from '../lease';
import { StorageAdapter } from '../storage';

const sessions = new Map<
  string,
  { storage: StorageAdapter; lease: SessionLease }
>();
function op(
  doc: string,
  owner: string,
  kind: number,
  extra: Partial<IStorageOpMsg> = {}
): IStorageOpMsg {
  return {
    kind,
    doc,
    owner,
    user: 'fixture-user',
    from: '',
    seq: 0n,
    through: 0n,
    before: 0n,
    retry: false,
    terminal: false,
    record: {
      seq: 1n,
      createdAt: 1n,
      user: 'fixture-user',
      foreign: false,
      quarantined: false,
      delivered: false,
      bytes: new Uint8Array([1, 255]),
    },
    snapshot: new Uint8Array(),
    coversOwner: '',
    coversSeq: 0n,
    ...extra,
  };
}
const fixture = {
  async open(doc: string, owner: string) {
    const lease = new SessionLease(doc, owner);
    const storage = new StorageAdapter(doc, owner, 'fixture-user');
    sessions.set(owner, { lease, storage });
    await lease.ready;
  },
  async execute(
    doc: string,
    owner: string,
    kind: number,
    extra: Partial<IStorageOpMsg> = {}
  ) {
    const s = sessions.get(owner);
    if (!s) throw new Error('Missing fixture session');
    await s.lease.ready;
    const r = await s.storage.execute(op(doc, owner, kind, extra));
    if (r.kind === 'loaded' && r.payload) {
      const v = LocalStateMsg.decode(r.payload);
      return {
        kind: r.kind,
        orphans: v.orphans.map((g) => ({
          owner: g.owner,
          seqs: g.records.map((r) => r.seq.toString()),
          bytes: g.records.map((r) => [...r.bytes]),
        })),
        assist: v.assist.map((g) => g.owner),
        snapshot: [...v.snapshot],
        coversSeq: v.coversSeq.toString(),
      };
    }
    return r;
  },
  async rows(doc: string) {
    const db = await openDB('macro-document-wal', 1);
    const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
    db.close();
    return rows.map((r) => ({
      owner: r.owner,
      seq: r.seq?.toString(),
      delivered: r.delivered,
      quarantined: r.quarantined,
      bytes: [...r.update],
    }));
  },
  injectAppendFailure(name: 'AbortError' | 'QuotaExceededError') {
    const original = IDBObjectStore.prototype.add;
    IDBObjectStore.prototype.add = function (
      this: IDBObjectStore,
      _value: unknown,
      _key?: IDBValidKey
    ) {
      IDBObjectStore.prototype.add = original;
      if (name === 'AbortError') this.transaction.abort();
      throw new DOMException('Fixture storage failure', name);
    };
  },
  async legacy(doc: string) {
    const db = await openDB('macro-document-wal', 1);
    await db.add('updates', {
      scopeId: doc,
      createdAt: 1,
      delivered: false,
      update: new Uint8Array([7]),
    });
    db.close();
  },
  async close(owner: string) {
    const s = sessions.get(owner);
    if (!s) return;
    await s.storage.drain();
    await s.lease.release();
    sessions.delete(owner);
  },
  async waitReleased(doc: string, owner: string) {
    await navigator.locks.request(`macro-wal:${doc}:${owner}`, () => undefined);
  },
  async held() {
    return (await navigator.locks.query()).held?.map((v) => v.name);
  },
};
declare global {
  interface Window {
    storageFixture: typeof fixture;
  }
}
window.storageFixture = fixture;
const output = document.querySelector('output');
if (output) output.textContent = 'ready';
