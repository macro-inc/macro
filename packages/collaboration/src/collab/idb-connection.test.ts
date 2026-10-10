import 'fake-indexeddb/auto';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBSnapshotStore } from './snapshot-store';
import { BrowserWALStore } from './wal';

let factory: IDBFactory;
let connections: IDBDatabase[];

beforeEach(() => {
  factory = new IDBFactory();
  connections = [];
  const open = factory.open.bind(factory);
  vi.spyOn(factory, 'open').mockImplementation((name, version) => {
    const request = open(name, version);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  });
  vi.stubGlobal('indexedDB', factory);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** What the browser does to every open connection after a backing-store failure. */
async function browserClosesConnections(): Promise<void> {
  for (const db of connections) {
    // fake-indexeddb types the parameter as the IDBDatabase class, not an instance.
    forceCloseDatabase(db as unknown as typeof IDBDatabase);
  }
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe('BrowserWALStore', () => {
  it('keeps working after the browser closes its connection', async () => {
    const store = new BrowserWALStore<string>('wal', 'doc');
    await store.append('before');

    await browserClosesConnections();
    await store.append('after');

    expect((await store.getAll()).map((e) => e.update)).toEqual([
      'before',
      'after',
    ]);
  });

  it('retries opening after a failed open', async () => {
    const open = factory.open.bind(factory);
    await new Promise<void>((resolve) => {
      const request = open('newer', 2);
      request.onsuccess = () => {
        request.result.close();
        resolve();
      };
    });
    vi.mocked(factory.open).mockImplementationOnce(() => open('newer', 1));
    const store = new BrowserWALStore<string>('wal', 'doc');

    await expect(store.append('lost')).rejects.toThrow();
    await store.append('kept');

    expect((await store.getAll()).map((e) => e.update)).toEqual(['kept']);
  });
});

describe('IDBSnapshotStore', () => {
  it('keeps working after the browser closes its connection', async () => {
    const store = new IDBSnapshotStore<string>('snapshots', 'doc');
    await store.save('v1');

    await browserClosesConnections();
    await store.save('v2');

    expect(await store.load()).toBe('v2');
  });
});
