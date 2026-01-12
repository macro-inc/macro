import type {
  PersistedClient,
  Persister,
} from '@tanstack/solid-query-persist-client';

type IDBPersisterOptions = Readonly<{
  dbName?: string;
  storeName?: string;
  key?: string;
}>;

const DEFAULT_DB = 'macro-query-cache';
const DEFAULT_STORE = 'persisted';
const DEFAULT_KEY = 'tanstack';

function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  dbName: string,
  storeName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB(dbName, storeName);
  try {
    return await new Promise<T>((resolve, reject) => {
      const tx = db.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      const req = fn(store);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

export function createIDBPersister(
  options: IDBPersisterOptions = {}
): Persister {
  const dbName = options.dbName ?? DEFAULT_DB;
  const storeName = options.storeName ?? DEFAULT_STORE;
  const key = options.key ?? DEFAULT_KEY;

  return {
    persistClient: async (client: PersistedClient) => {
      const value = JSON.stringify(client);
      await withStore(dbName, storeName, 'readwrite', (store) =>
        store.put(value, key)
      );
    },
    restoreClient: async () => {
      const value = await withStore<string | undefined>(
        dbName,
        storeName,
        'readonly',
        (store) => store.get(key)
      );
      if (!value) return undefined;
      try {
        return JSON.parse(value) as PersistedClient;
      } catch {
        return undefined;
      }
    },
    removeClient: async () => {
      await withStore(dbName, storeName, 'readwrite', (store) =>
        store.delete(key)
      );
    },
  };
}
