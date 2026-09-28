import { beforeEach, describe, expect, it } from 'vitest';
import { IDBSnapshotStore, InMemorySnapshotStore } from './snapshot-store';

let run = 0;
let dbName: string;
beforeEach(() => {
  dbName = `snapshot-test-${++run}`;
});

describe.each([
  [
    'IDBSnapshotStore',
    (scope: string) => new IDBSnapshotStore<string>(dbName, scope),
  ],
  ['InMemorySnapshotStore', () => new InMemorySnapshotStore<string>()],
])('%s', (_name, open) => {
  it('loads null before any save', async () => {
    expect(await open('a').load()).toBeNull();
  });

  it('replaces the value on each save and forgets it on delete', async () => {
    const store = open('a');
    await store.save('one');
    await store.save('two');
    expect(await store.load()).toBe('two');
    await store.delete();
    expect(await store.load()).toBeNull();
  });
});

describe('IDBSnapshotStore', () => {
  it('keeps scopes in one database apart', async () => {
    const a = new IDBSnapshotStore<string>(dbName, 'a');
    const b = new IDBSnapshotStore<string>(dbName, 'b');
    await a.save('for a');
    expect(await b.load()).toBeNull();
    await b.save('for b');
    await a.delete();
    expect(await b.load()).toBe('for b');
  });

  it('survives a fresh handle on the same scope', async () => {
    await new IDBSnapshotStore<Uint8Array>(dbName, 'a').save(
      new Uint8Array([1, 2, 3])
    );
    expect(await new IDBSnapshotStore<Uint8Array>(dbName, 'a').load()).toEqual(
      new Uint8Array([1, 2, 3])
    );
  });

  it('narrates reads and writes to the logger', async () => {
    const lines: string[] = [];
    const store = new IDBSnapshotStore<string>(dbName, 'a', {
      debug: (message) => lines.push(message),
    });
    await store.load();
    await store.save('x');
    await store.load();
    expect(lines).toEqual([
      'snapshot-store: no snapshot found',
      'snapshot-store: saved to IDB',
      'snapshot-store: loaded from IDB',
    ]);
  });

  it('clears every scope at once', async () => {
    await new IDBSnapshotStore<string>(dbName, 'a').save('a');
    await new IDBSnapshotStore<string>(dbName, 'b').save('b');
    await IDBSnapshotStore.clear(dbName);
    expect(await new IDBSnapshotStore<string>(dbName, 'a').load()).toBeNull();
    expect(await new IDBSnapshotStore<string>(dbName, 'b').load()).toBeNull();
  });

  it('prunes the scopes the selector names', async () => {
    await new IDBSnapshotStore<number>(dbName, 'old').save(1);
    await new IDBSnapshotStore<number>(dbName, 'new').save(2);
    const seen: string[] = [];
    const deleted = await IDBSnapshotStore.prune<number>(dbName, (saved) => {
      seen.push(...saved.map((row) => `${row.scopeId}=${row.snapshot}`));
      return saved.filter((row) => row.snapshot < 2).map((row) => row.scopeId);
    });
    expect(seen.sort()).toEqual(['new=2', 'old=1']);
    expect(deleted).toBe(1);
    expect(await new IDBSnapshotStore<number>(dbName, 'old').load()).toBeNull();
    expect(await new IDBSnapshotStore<number>(dbName, 'new').load()).toBe(2);
  });
});
