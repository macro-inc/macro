import 'fake-indexeddb/auto';
import { IDBObjectStore } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
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

afterEach(() => vi.restoreAllMocks());

describe('clearable query persistence', () => {
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
