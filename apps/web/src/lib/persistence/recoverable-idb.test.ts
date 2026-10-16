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
