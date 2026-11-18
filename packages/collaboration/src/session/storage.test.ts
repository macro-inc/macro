import 'fake-indexeddb/auto';
import { openDB } from 'idb';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { Failure, type IStorageOpMsg, LocalStateMsg } from './abi.generated';
import { ownerLock, StorageAdapter } from './storage';

const owner = '00000000-0000-0000-0000-000000000001';
const other = '00000000-0000-0000-0000-000000000002';
let doc = '';
beforeEach(() => {
  doc = `fixture-${crypto.randomUUID()}`;
});
afterEach(() => {
  vi.restoreAllMocks();
});
const locks = {
  query: async () => ({ held: [], pending: [] }),
  request: navigator.locks.request.bind(navigator.locks),
};
function op(kind: number, extra: Partial<IStorageOpMsg> = {}): IStorageOpMsg {
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
    expected:
      kind === 5
        ? [
            {
              seq: 1n,
              createdAt: 1n,
              user: 'fixture-user',
              foreign: false,
              quarantined: false,
              delivered: false,
              bytes: new Uint8Array([1, 255]),
            },
          ]
        : [],
    ...extra,
  };
}

test('literal v1 append survives a new adapter and uncertain retry without duplication', async () => {
  const adapter = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const append: IStorageOpMsg = {
    kind: 2,
    doc,
    owner,
    user: 'fixture-user',
    from: '',
    seq: 0n,
    through: 0n,
    before: 0n,
    retry: false,
    terminal: true,
    record: {
      seq: 9007199254740993n,
      createdAt: 25n,
      user: 'fixture-user',
      foreign: true,
      quarantined: false,
      delivered: false,
      bytes: new Uint8Array([0, 255, 1]),
    },
    snapshot: new Uint8Array(),
    coversOwner: '',
    coversSeq: 0n,
    expected: [],
  };
  expect(await adapter.execute(append)).toEqual({
    kind: 'done',
    ok: true,
    failure: Failure.None,
  });
  const restarted = new StorageAdapter(doc, owner, 'fixture-user', locks);
  expect(await restarted.execute({ ...append, retry: true })).toEqual({
    kind: 'done',
    ok: true,
    failure: Failure.None,
  });
  const db = await openDB('macro-document-wal', 1);
  const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
  db.close();
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({
    scopeId: doc,
    owner,
    seq: 9007199254740993n,
    delivered: false,
    foreign: true,
    update: new Uint8Array([0, 255, 1]),
  });
});
test('two adopters atomically move an orphan once and retain all metadata', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  await a.execute(op(2));
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  const third = '00000000-0000-0000-0000-000000000003';
  const c = new StorageAdapter(doc, third, 'fixture-user', locks);
  const results = await Promise.all([
    b.execute(op(5, { owner: other, from: owner, seq: 10n })),
    c.execute(op(5, { owner: third, from: owner, seq: 10n })),
  ]);
  expect(
    results.filter((r) => r.kind === 'adopted' && r.adopted === 1)
  ).toHaveLength(1);
  for (const result of results)
    expect([
      { kind: 'adopted', adopted: 1, failure: Failure.None },
      { kind: 'adopted', adopted: 0, failure: Failure.None },
      { kind: 'adopted', adopted: -1, failure: Failure.Other },
    ]).toContainEqual(result);
  expect(
    await b.execute(op(5, { owner: other, from: owner, seq: 10n }))
  ).toEqual({ kind: 'adopted', adopted: 0, failure: Failure.None });
  expect(
    await c.execute(op(5, { owner: third, from: owner, seq: 10n }))
  ).toEqual({ kind: 'adopted', adopted: 0, failure: Failure.None });
  const db = await openDB('macro-document-wal', 1);
  const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
  db.close();
  expect(rows).toHaveLength(1);
  expect(rows[0].seq).toBe(10n);
  expect(rows[0].update).toEqual(new Uint8Array([1, 255]));
});
test('load separates legacy/free owners, live assistance and other users', async () => {
  const db = await openDB('macro-document-wal', 1);
  for (const row of [
    {
      scopeId: doc,
      update: new Uint8Array([1]),
      delivered: false,
      createdAt: 1,
    },
    {
      scopeId: doc,
      owner: other,
      seq: 1n,
      user: 'fixture-user',
      update: new Uint8Array([2]),
      delivered: false,
      createdAt: 2,
    },
    {
      scopeId: doc,
      owner: 'foreign-owner',
      seq: 1n,
      user: 'another-fixture-user',
      update: new Uint8Array([3]),
      delivered: false,
      createdAt: 3,
    },
  ])
    await db.add('updates', row);
  db.close();
  const live = {
    ...locks,
    query: async () => ({
      held: [{ name: ownerLock(doc, other), mode: 'exclusive' as const }],
      pending: [],
    }),
  };
  const a = new StorageAdapter(doc, owner, 'fixture-user', live);
  const result = await a.execute(op(0));
  expect(result.kind).toBe('loaded');
  if (result.kind !== 'loaded' || !result.payload) throw new Error('load');
  const state = LocalStateMsg.decode(result.payload);
  expect(state.orphans.map((v) => v.owner)).toEqual(['', 'foreign-owner']);
  expect(state.assist.map((v) => v.owner)).toEqual([other]);
  expect(state.snapshot.byteLength).toBe(0);
});
test('quarantine retains rows and pruning deletes only delivered own rows', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  await a.execute(op(2));
  await a.execute(op(7, { seq: 1n }));
  await a.execute(op(4, { through: 1n }));
  let db = await openDB('macro-document-wal', 1);
  let rows = await db.getAllFromIndex('updates', 'scopeId', doc);
  db.close();
  expect(rows).toHaveLength(1);
  expect(rows[0].quarantined).toBe(true);
  await a.execute(op(3, { through: 1n }));
  await a.execute(
    op(8, { snapshot: new Uint8Array([9]), coversOwner: owner, coversSeq: 1n })
  );
  await a.execute(op(4, { through: 1n }));
  db = await openDB('macro-document-wal', 1);
  rows = await db.getAllFromIndex('updates', 'scopeId', doc);
  db.close();
  expect(rows).toHaveLength(0);
});
test('snapshot save/delete never removes WAL and old snapshots carry no covers', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  await a.execute(op(2));
  await a.execute(
    op(8, { snapshot: new Uint8Array([9]), coversOwner: owner, coversSeq: 1n })
  );
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  const result = await b.execute(op(0, { owner: other }));
  if (result.kind !== 'loaded' || !result.payload) throw new Error('load');
  expect(LocalStateMsg.decode(result.payload).coversSeq).toBe(1n);
  await a.execute(op(9));
  const db = await openDB('macro-document-wal', 1);
  expect(await db.countFromIndex('updates', 'scopeId', doc)).toBe(1);
  db.close();
});
test('a proven rolled-back append retries once and does not duplicate', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const add = IDBObjectStore.prototype.add;
  let failed = false;
  vi.spyOn(IDBObjectStore.prototype, 'add').mockImplementation(function (
    this: IDBObjectStore,
    ...args: Parameters<typeof add>
  ) {
    if (!failed) {
      failed = true;
      this.transaction.abort();
      throw new DOMException('Fixture rollback', 'AbortError');
    }
    return add.apply(this, args);
  });
  expect(await a.execute(op(2))).toEqual({
    kind: 'done',
    ok: true,
    failure: Failure.None,
  });
  const db = await openDB('macro-document-wal', 1);
  expect(await db.countFromIndex('updates', 'scopeId', doc)).toBe(1);
  db.close();
});
test('foreign-user adoption is refused without changing or deleting the source', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  await a.execute(op(2));
  const b = new StorageAdapter(doc, other, 'another-fixture-user', locks);
  const result = await b.execute(op(5, { owner: other, from: owner, seq: 2n }));
  expect(result).toEqual({
    kind: 'adopted',
    adopted: -1,
    failure: Failure.Corrupt,
  });
  const db = await openDB('macro-document-wal', 1);
  const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
  db.close();
  expect(rows[0].owner).toBe(owner);
});

test('adoption follows stored sequences rather than physical insertion order', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  await a.execute(
    op(2, { record: { ...op(2).record, seq: 2n, bytes: new Uint8Array([2]) } })
  );
  await a.execute(
    op(2, { record: { ...op(2).record, seq: 1n, bytes: new Uint8Array([1]) } })
  );
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  expect(
    await b.execute(
      op(5, {
        owner: other,
        from: owner,
        seq: 10n,
        expected: [
          { ...op(2).record, seq: 1n, bytes: new Uint8Array([1]) },
          { ...op(2).record, seq: 2n, bytes: new Uint8Array([2]) },
        ],
      })
    )
  ).toMatchObject({ kind: 'adopted', adopted: 2 });
  const db = await openDB('macro-document-wal', 1);
  const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
  db.close();
  expect(
    rows
      .map((row) => [row.seq, [...row.update]])
      .sort((a, b) => String(a[0]).localeCompare(String(b[0])))
  ).toEqual([
    [10n, [1]],
    [11n, [2]],
  ]);
});

test('adoption refuses a changed selection without mutating either database', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  await a.execute(op(2));
  await a.execute(op(8, { snapshot: new Uint8Array([9]) }));
  const db = await openDB('macro-document-wal', 1);
  const original = (await db.getAllFromIndex('updates', 'scopeId', doc))[0];
  for (const changed of [
    { ...original, update: new Uint8Array([2, 255]) },
    { ...original, delivered: true },
    { ...original, quarantined: true },
    { ...original, foreign: true },
    { ...original, createdAt: 2 },
    { ...original, user: 'different-fixture-user' },
  ]) {
    await db.put('updates', changed);
    expect(
      await b.execute(op(5, { owner: other, from: owner, seq: 10n }))
    ).toEqual({ kind: 'adopted', adopted: -1, failure: Failure.Other });
    expect(await db.getAllFromIndex('updates', 'scopeId', doc)).toEqual([
      changed,
    ]);
    const snapshots = await openDB('macro-document-snapshots', 1);
    expect(await snapshots.get('snapshots', doc)).toEqual({
      scopeId: doc,
      snapshot: new Uint8Array([9]),
    });
    snapshots.close();
  }
  db.close();
});

test('adoption refuses both advanced and regressed snapshot covers', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  await a.execute(op(2));
  for (const [actual, observed] of [
    [2n, 1n],
    [1n, 2n],
  ]) {
    await a.execute(
      op(8, {
        snapshot: new Uint8Array([9]),
        coversOwner: owner,
        coversSeq: actual,
      })
    );
    expect(
      await b.execute(
        op(5, { owner: other, from: owner, seq: 10n, through: observed })
      )
    ).toEqual({ kind: 'adopted', adopted: -1, failure: Failure.Other });
    const db = await openDB('macro-document-wal', 1);
    const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      owner,
      seq: 1n,
      delivered: false,
      update: new Uint8Array([1, 255]),
    });
    const snapshots = await openDB('macro-document-snapshots', 1);
    expect(await snapshots.get('snapshots', doc)).toEqual({
      scopeId: doc,
      snapshot: new Uint8Array([9]),
      covers: { owner, seq: actual },
    });
    snapshots.close();
  }
});

test('an owner that reacquires its lease cannot have its rows adopted', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  await a.execute(op(2));
  await locks.request(ownerLock(doc, owner), async () => {
    expect(
      await b.execute(op(5, { owner: other, from: owner, seq: 10n }))
    ).toEqual({ kind: 'adopted', adopted: -1, failure: Failure.Other });
    const db = await openDB('macro-document-wal', 1);
    const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0].owner).toBe(owner);
  });
  expect(
    await b.execute(op(5, { owner: other, from: owner, seq: 10n }))
  ).toEqual({ kind: 'adopted', adopted: 1, failure: Failure.None });
});

test('adoption rejects destination collisions and sequence overflow atomically', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  await a.execute(op(2));
  await a.execute(op(2, { record: { ...op(2).record, seq: 2n } }));
  await b.execute(
    op(2, { owner: other, record: { ...op(2).record, seq: 10n } })
  );
  const db = await openDB('macro-document-wal', 1);
  const before = await db.getAllFromIndex('updates', 'scopeId', doc);
  for (const seq of [10n, 0xffff_ffff_ffff_ffffn]) {
    expect(
      await b.execute(
        op(5, {
          owner: other,
          from: owner,
          seq,
          expected: [op(2).record, { ...op(2).record, seq: 2n }],
        })
      )
    ).toEqual({ kind: 'adopted', adopted: -1, failure: Failure.Other });
    expect(await db.getAllFromIndex('updates', 'scopeId', doc)).toEqual(before);
  }
  db.close();
});

test('pruning uses the current snapshot cover after legacy writers replace it', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  await a.execute(op(2));
  await a.execute(op(3, { through: 1n }));
  const snapshots = await openDB('macro-document-snapshots', 1);
  for (const row of [
    undefined,
    { scopeId: doc, snapshot: new Uint8Array([9]) },
    {
      scopeId: doc,
      snapshot: new Uint8Array([9]),
      covers: { owner: other, seq: 1n },
    },
    { scopeId: doc, snapshot: new Uint8Array([9]), covers: { owner, seq: 0n } },
  ]) {
    if (row) await snapshots.put('snapshots', row);
    expect(await a.execute(op(4, { through: 1n }))).toEqual({
      kind: 'done',
      ok: true,
      failure: Failure.None,
    });
    const db = await openDB('macro-document-wal', 1);
    const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
    db.close();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ owner, seq: 1n, delivered: true });
  }
  await a.execute(
    op(8, { snapshot: new Uint8Array([9]), coversOwner: owner, coversSeq: 1n })
  );
  await a.execute(op(4, { through: 1n }));
  const db = await openDB('macro-document-wal', 1);
  expect(await db.countFromIndex('updates', 'scopeId', doc)).toBe(0);
  db.close();
  snapshots.close();
});

test('TTL cleanup cannot delete rows after their owner reacquires its lease', async () => {
  const a = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const b = new StorageAdapter(doc, other, 'fixture-user', locks);
  await a.execute(op(2));
  await locks.request(ownerLock(doc, owner), async () => {
    expect(
      await b.execute(op(6, { owner: other, from: owner, before: 2n }))
    ).toEqual({ kind: 'done', ok: false, failure: Failure.Other });
    const db = await openDB('macro-document-wal', 1);
    expect(await db.countFromIndex('updates', 'scopeId', doc)).toBe(1);
    db.close();
  });
  expect(
    await b.execute(op(6, { owner: other, from: owner, before: 2n }))
  ).toEqual({ kind: 'done', ok: true, failure: Failure.None });
  const db = await openDB('macro-document-wal', 1);
  expect(await db.countFromIndex('updates', 'scopeId', doc)).toBe(0);
  db.close();
});

test('a session row without a user cannot become current-user recovery history', async () => {
  const db = await openDB('macro-document-wal', 1);
  await db.add('updates', {
    scopeId: doc,
    owner: other,
    seq: 1n,
    update: new Uint8Array([1, 255]),
    delivered: false,
    createdAt: 1,
  });
  const adapter = new StorageAdapter(doc, owner, 'fixture-user', locks);
  const loaded = await adapter.execute(op(0));
  if (loaded.kind !== 'loaded' || !loaded.payload) throw new Error('load');
  expect(
    LocalStateMsg.decode(loaded.payload).orphans[0]?.records[0]?.user
  ).toBe('');
  expect(await adapter.execute(op(5, { from: other, seq: 1n }))).toEqual({
    kind: 'adopted',
    adopted: -1,
    failure: Failure.Other,
  });
  const rows = await db.getAllFromIndex('updates', 'scopeId', doc);
  expect(rows).toHaveLength(1);
  expect(rows[0]).toMatchObject({ owner: other, seq: 1n });
  expect(rows[0]?.user).toBeUndefined();
  db.close();
});
