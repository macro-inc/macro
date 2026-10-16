import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createPerQueryIDBStore,
  type PersistedQueryEntry,
} from './per-query-idb';

const entry = (id: string): PersistedQueryEntry => ({
  queryHash: id,
  queryKey: [id],
  data: id,
  dataUpdatedAt: 1,
  persistedAt: 1,
  buster: 'test',
});
const store = () =>
  createPerQueryIDBStore({
    dbName: `query-clear-test-${crypto.randomUUID()}`,
    debounceMs: 60_000,
  });

let connections: IDBDatabase[];
beforeEach(() => {
  connections = [];
  const open = indexedDB.open.bind(indexedDB);
  vi.spyOn(indexedDB, 'open').mockImplementation((...args) => {
    const request = open(...args);
    request.addEventListener('success', () => connections.push(request.result));
    return request;
  });
});
afterEach(() => {
  vi.restoreAllMocks();
  for (const db of connections) db.close();
});

describe('query persistence connection recovery', () => {
  it('recovers reads, writes, deletes and clear without losing cached entries', async () => {
    const db = store();
    db.set(entry('original'));
    await db.flush({ throwOnError: true });
    connections.at(-1)!.close();
    expect(await db.get('original')).toEqual(entry('original'));
    connections.at(-1)!.close();
    db.set(entry('next'));
    await db.flush({ throwOnError: true });
    expect(await db.get('original')).toEqual(entry('original'));
    connections.at(-1)!.close();
    db.remove('original');
    await db.flush({ throwOnError: true });
    expect(await db.get('original')).toBeUndefined();
    expect(await db.get('next')).toEqual(entry('next'));
    connections.at(-1)!.close();
    await db.clear();
    expect(await db.get('next')).toBeUndefined();
    expect(connections).toHaveLength(5);
  });

  it('shares the replacement across stores for the same database', async () => {
    const name = crypto.randomUUID();
    const first = createPerQueryIDBStore({ dbName: name });
    const second = createPerQueryIDBStore({ dbName: name });
    await Promise.all([first.get('missing'), second.get('missing')]);
    expect(connections).toHaveLength(1);
    connections[0].close();
    await Promise.all([first.get('missing'), second.get('missing')]);
    expect(connections).toHaveLength(2);
  });

  it('does not write an old generation when clear runs during recovery', async () => {
    const db = store();
    await db.clear();
    let clearing: Promise<void> | undefined;
    vi.spyOn(connections[0], 'transaction').mockImplementationOnce(() => {
      clearing = db.clear();
      throw new DOMException('Closing', 'InvalidStateError');
    });
    const put = vi.spyOn(IDBObjectStore.prototype, 'put');
    db.set(entry('old'));
    await db.flush({ throwOnError: true });
    await clearing;
    expect(put).not.toHaveBeenCalled();
    db.set(entry('new'));
    await db.flush({ throwOnError: true });
    expect(await db.get('old')).toBeUndefined();
    expect(await db.get('new')).toEqual(entry('new'));
  });

  it('retains pending writes after recovery is exhausted', async () => {
    const db = store();
    await db.clear();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(() => {
        throw new DOMException('Closing', 'InvalidStateError');
      });
    db.set(entry('pending'));
    await expect(db.flush({ throwOnError: true })).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
    expect(transaction).toHaveBeenCalledTimes(2);
    transaction.mockRestore();
    await db.flush({ throwOnError: true });
    expect(await db.get('pending')).toEqual(entry('pending'));
  });
});

describe('clearable query persistence', () => {
  it('rejects a strict flush on storage failure and retries the pending data', async () => {
    const db = store();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      throw new Error('Storage unavailable');
    });
    db.set(entry('pending'));
    await expect(db.flush({ throwOnError: true })).rejects.toThrow(
      'Storage unavailable'
    );
    await db.flush({ throwOnError: true });
    expect(await db.get('pending')).toEqual(entry('pending'));
  });

  it('strict flush waits for an already started write with an empty pending queue', async () => {
    const db = store();
    await db.clear();
    const started = Promise.withResolvers<void>();
    const put = IDBObjectStore.prototype.put;
    let completed = false;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
      this: IDBObjectStore,
      value,
      key
    ) {
      this.transaction.addEventListener('complete', () => {
        completed = true;
      });
      started.resolve();
      return put.call(this, value, key);
    });
    db.set(entry('pending'));
    const background = db.flush();
    await started.promise;
    await db.flush({ throwOnError: true });
    expect(completed).toBe(true);
    await background;
  });

  it('fences pending puts and deletes', async () => {
    const db = store();
    db.set(entry('old'));
    await db.flush();
    db.set(entry('pending'));
    db.remove('old');
    await db.clear();
    await db.flush();
    expect(await db.get('old')).toBeUndefined();
    expect(await db.get('pending')).toBeUndefined();
  });

  it('orders clear after old writes and before new-session writes', async () => {
    const db = store();
    db.set(entry('old'));
    const flushing = db.flush();
    const clearing = db.clear();
    db.set(entry('new'));
    const newWrite = db.flush();
    await Promise.all([flushing, clearing, newWrite]);
    expect(await db.get('old')).toBeUndefined();
    expect(await db.get('new')).toEqual(entry('new'));
    await db.clear();
  });

  it('waits for an already started transaction before clearing', async () => {
    const db = store();
    await db.clear();
    const started = Promise.withResolvers<void>();
    const put = IDBObjectStore.prototype.put;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(function (
      this: IDBObjectStore,
      value,
      key
    ) {
      const request = put.call(this, value, key);
      started.resolve();
      return request;
    });
    db.set(entry('old'));
    const flushing = db.flush();
    await started.promise;
    const clearing = db.clear();
    await Promise.all([flushing, clearing]);
    expect(await db.get('old')).toBeUndefined();
  });

  it('does not resurrect failed old writes after clear', async () => {
    const db = store();
    await db.clear();
    let clearing: Promise<void> | undefined;
    vi.spyOn(IDBObjectStore.prototype, 'put').mockImplementationOnce(() => {
      clearing = db.clear();
      throw new Error('Simulated storage failure');
    });
    db.set(entry('old'));
    await db.flush();
    await clearing;
    await db.flush();
    expect(await db.get('old')).toBeUndefined();
  });
});
