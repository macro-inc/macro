import 'fake-indexeddb/auto';
import { forceCloseDatabase } from 'fake-indexeddb';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RecoverableIDB } from './recoverable-idb';

const databases: RecoverableIDB[] = [];
function database() {
  const db = new RecoverableIDB(crypto.randomUUID(), 1, (db) =>
    db.createObjectStore('items')
  );
  databases.push(db);
  return db;
}
afterEach(async () => {
  vi.restoreAllMocks();
  for (const db of databases.splice(0)) await db.close();
});

describe('recoverable native IndexedDB connections', () => {
  it.each(['closed', 'terminated'])(
    'shares one replacement after a connection is %s',
    async (reason) => {
      const db = database();
      const original = await db.open();
      const open = vi.spyOn(indexedDB, 'open');
      if (reason === 'closed') original.close();
      else {
        const closed = new Promise<void>((resolve) =>
          original.addEventListener('close', () => resolve())
        );
        // The library accepts an instance but declares a constructor type.
        forceCloseDatabase(
          original as unknown as Parameters<typeof forceCloseDatabase>[0]
        );
        await closed;
      }
      const [first, second] = await Promise.all([
        db.transaction('items', 'readonly'),
        db.transaction('items', 'readonly'),
      ]);
      expect(first.db).toBe(second.db);
      expect(first.db).not.toBe(original);
      expect(open).toHaveBeenCalledOnce();
      original.onclose?.call(original, new Event('close'));
      expect(await db.open()).toBe(first.db);
    }
  );

  it('bounds transaction creation retries and permits a later recovery', async () => {
    const db = database();
    await db.open();
    const error = new DOMException('Closing', 'InvalidStateError');
    const transaction = vi
      .spyOn(IDBDatabase.prototype, 'transaction')
      .mockImplementation(() => {
        throw error;
      });
    await expect(db.transaction('items', 'readwrite')).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledTimes(2);
    transaction.mockRestore();
    await expect(db.transaction('items', 'readwrite')).resolves.toBeDefined();
  });

  it('does not retry unrelated errors', async () => {
    const db = database();
    const native = await db.open();
    const error = new DOMException('Quota exhausted', 'QuotaExceededError');
    const transaction = vi
      .spyOn(native, 'transaction')
      .mockImplementationOnce(() => {
        throw error;
      });
    await expect(db.transaction('items', 'readwrite')).rejects.toBe(error);
    expect(transaction).toHaveBeenCalledOnce();
    expect(await db.open()).toBe(native);
  });

  it('releases connections for version changes', async () => {
    const db = database();
    const native = await db.open();
    const upgraded = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open(native.name, 2);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    upgraded.close();
    expect(() => native.transaction('items')).toThrow();
    const open = vi.spyOn(indexedDB, 'open');
    await expect(db.open()).rejects.toMatchObject({ name: 'VersionError' });
    await expect(db.open()).rejects.toMatchObject({ name: 'VersionError' });
    expect(open).toHaveBeenCalledTimes(2);
  });

  it('does not cache synchronous opening failures', async () => {
    const db = database();
    vi.spyOn(indexedDB, 'open').mockImplementationOnce(() => {
      throw new Error('Unavailable');
    });
    await expect(db.transaction('items', 'readonly')).rejects.toThrow(
      'Unavailable'
    );
    await expect(db.transaction('items', 'readonly')).resolves.toBeDefined();
  });

  it('replays a transaction the platform aborts mid-write on a fresh connection', async () => {
    const lost = vi.fn();
    const db = new RecoverableIDB(
      crypto.randomUUID(),
      1,
      (db) => db.createObjectStore('items'),
      undefined,
      lost
    );
    databases.push(db);
    const original = await db.open();
    let runs = 0;
    const value = await db.run<number>('items', 'readwrite', (tx, finish) => {
      const store = tx.objectStore('items');
      const read = store.get('count');
      read.onsuccess = () => {
        const next = (read.result ?? 0) + 1;
        store.put(next, 'count');
        finish(next);
        // WebKit stops the transaction after its requests were issued.
        if (runs++ === 0) tx.abort();
      };
    });
    expect(value).toBe(1);
    expect(runs).toBe(2);
    expect(lost).toHaveBeenCalledOnce();
    expect(await db.open()).not.toBe(original);
  });

  it('bounds replays and rejects with the interruption', async () => {
    const db = database();
    const body = vi.fn((tx: IDBTransaction) => {
      tx.objectStore('items').put('value', 'key');
      tx.abort();
    });
    await expect(db.run('items', 'readwrite', body)).rejects.toMatchObject({
      name: 'AbortError',
    });
    expect(body).toHaveBeenCalledTimes(3);
    await expect(
      db.run<string>('items', 'readonly', (tx, finish) => {
        const read = tx.objectStore('items').get('key');
        read.onsuccess = () => finish(read.result);
      })
    ).resolves.toBeUndefined();
  });

  it('does not replay request failures that are not interruptions', async () => {
    const db = database();
    await db.run('items', 'readwrite', (tx) => {
      tx.objectStore('items').add('first', 'key');
    });
    const native = await db.open();
    const body = vi.fn((tx: IDBTransaction) => {
      tx.objectStore('items').add('second', 'key');
    });
    await expect(db.run('items', 'readwrite', body)).rejects.toMatchObject({
      name: 'ConstraintError',
    });
    expect(body).toHaveBeenCalledOnce();
    expect(await db.open()).toBe(native);
  });

  it('does not replay a body that throws', async () => {
    const db = database();
    const error = new Error('Invalid input');
    const body = vi.fn((tx: IDBTransaction) => {
      tx.objectStore('items').put('partial', 'key');
      throw error;
    });
    await expect(db.run('items', 'readwrite', body)).rejects.toBe(error);
    expect(body).toHaveBeenCalledOnce();
    await expect(
      db.run<string>('items', 'readonly', (tx, finish) => {
        const read = tx.objectStore('items').get('key');
        read.onsuccess = () => finish(read.result);
      })
    ).resolves.toBeUndefined();
  });

  it('does not replay a body whose request callback throws', async () => {
    const lost = vi.fn();
    const db = new RecoverableIDB(
      crypto.randomUUID(),
      1,
      (db) => db.createObjectStore('items'),
      undefined,
      lost
    );
    databases.push(db);
    const native = await db.open();
    const callback = vi.fn(() => {
      throw new Error('Invalid stored value');
    });
    await expect(
      db.run('items', 'readwrite', (tx) => {
        tx.objectStore('items').get('key').onsuccess = callback;
      })
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(callback).toHaveBeenCalledOnce();
    expect(lost).not.toHaveBeenCalled();
    expect(await db.open()).toBe(native);
  });

  it('closes an in-flight open and never revives a disposed owner', async () => {
    const db = database();
    const pending = db.transaction('items', 'readonly');
    const failure = expect(pending).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
    await db.close();
    await failure;
    await expect(db.transaction('items', 'readonly')).rejects.toMatchObject({
      name: 'InvalidStateError',
    });
  });
});
