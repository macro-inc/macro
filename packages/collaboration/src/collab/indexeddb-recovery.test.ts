import 'fake-indexeddb/auto';
import { forceCloseDatabase, IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IDBSnapshotStore } from './snapshot-store';
import { BrowserWALStore, WALSyncer } from './wal';

let connections: IDBDatabase[];

beforeEach(() => {
  connections = [];
  const factory = new IDBFactory();
  vi.stubGlobal('indexedDB', factory);
  const open = factory.open.bind(factory);
  vi.spyOn(factory, 'open').mockImplementation((...args) => {
    const request = open(...args);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  });
});

afterEach(() => {
  for (const db of connections) db.close();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('collaboration IndexedDB recovery', () => {
  it('flushes persisted edits after the WAL connection closes', async () => {
    const store = new BrowserWALStore<Uint8Array>('wal', 'doc');
    const push = vi.fn(async (_updates: Uint8Array[]) => true);
    const wal = new WALSyncer(store, push);
    await wal.ready();
    await store.append(new Uint8Array([1, 2, 3]));
    connections[0]!.close();

    await wal.flush();
    await wal.flush();

    expect(push).toHaveBeenCalledOnce();
    // IndexedDB clones into the host realm rather than jsdom's typed-array realm.
    expect(push.mock.calls[0]![0].map((update) => Array.from(update))).toEqual([
      [1, 2, 3],
    ]);
    expect(await store.getAll()).toEqual([
      expect.objectContaining({ id: 1, delivered: true }),
    ]);
    expect(connections).toHaveLength(2);
  });

  it('shares a reopened connection across concurrent appends without duplicates', async () => {
    const store = new BrowserWALStore<number>('wal', 'doc');
    await store.append(1);
    connections[0]!.close();

    await Promise.all([store.append(2), store.append(3), store.count()]);

    expect((await store.getAll()).map((entry) => entry.update)).toEqual([
      1, 2, 3,
    ]);
    expect(connections).toHaveLength(2);
  });

  it('recovers after the browser forcibly terminates a connection', async () => {
    const store = new BrowserWALStore<number>('wal', 'doc');
    await store.append(1);
    const db = connections[0]!;
    const closed = new Promise<void>((resolve) =>
      db.addEventListener('close', () => resolve())
    );
    // fake-indexeddb declares a constructor here, but accepts a database instance.
    forceCloseDatabase(
      db as unknown as Parameters<typeof forceCloseDatabase>[0]
    );
    await closed;

    expect(await store.count()).toBe(1);
    expect(connections).toHaveLength(2);
  });

  it('recovers snapshot reads and writes while keeping document scopes separate', async () => {
    const first = new IDBSnapshotStore<number>('snapshots', 'first');
    const second = new IDBSnapshotStore<number>('snapshots', 'second');
    await first.save(1);
    await second.save(2);
    connections[0]!.close();
    expect(await first.load()).toBe(1);
    connections.at(-1)!.close();
    await first.save(3);

    expect(await first.load()).toBe(3);
    expect(await second.load()).toBe(2);
  });

  it('bounds recovery attempts and permits a later retry', async () => {
    const store = new BrowserWALStore<number>('wal', 'doc');
    await store.append(1);
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(() => {
        throw new DOMException('Connection is closing', 'InvalidStateError');
      });

    await expect(store.count()).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    transaction.mockRestore();

    expect(await store.count()).toBe(1);
  });

  it('does not retry unrelated transaction failures', async () => {
    const store = new BrowserWALStore<number>('wal', 'doc');
    await store.append(1);
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(() => {
        throw new DOMException('Storage unavailable', 'UnknownError');
      });

    await expect(store.append(2)).rejects.toMatchObject({
      name: 'UnknownError',
    });
    expect(transaction).toHaveBeenCalledOnce();
    transaction.mockRestore();
    expect(await store.count()).toBe(1);
  });

  it('does not replay a write if the connection terminates after the transaction starts', async () => {
    const store = new BrowserWALStore<number>('wal', 'doc');
    await store.append(1);
    const db = connections[0]!;
    const closed = new Promise<void>((resolve) =>
      db.addEventListener('close', () => resolve())
    );
    const add = IDBObjectStore.prototype.add;
    const write = vi
      .spyOn(IDBObjectStore.prototype, 'add')
      .mockImplementation(function (value, key) {
        const request = add.call(this, value, key);
        // Simulate an interrupted write as well as the connection close event.
        this.transaction.abort();
        forceCloseDatabase(
          db as unknown as Parameters<typeof forceCloseDatabase>[0]
        );
        return request;
      });

    await expect(store.append(2)).rejects.toMatchObject({ name: 'AbortError' });
    await closed;
    expect(write).toHaveBeenCalledOnce();
    write.mockRestore();

    expect((await store.getAll()).map((entry) => entry.update)).toEqual([1]);
  });

  it('releases the connection when another client upgrades the database', async () => {
    const store = new BrowserWALStore<number>('wal', 'doc');
    await store.append(1);
    const request = indexedDB.open('wal', 2);
    await new Promise<void>((resolve, reject) => {
      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error('Upgrade was blocked'));
    });

    // The old client must not bypass a schema version change or delete data.
    await expect(store.count()).rejects.toMatchObject({ name: 'VersionError' });
    const read = request.result
      .transaction('updates')
      .objectStore('updates')
      .getAll();
    const entries = await new Promise<unknown[]>((resolve, reject) => {
      read.onsuccess = () => resolve(read.result);
      read.onerror = () => reject(read.error);
    });
    expect(entries).toHaveLength(1);
  });
});
