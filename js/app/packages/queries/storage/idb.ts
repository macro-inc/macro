import type {
  PersistedClient,
  Persister,
} from '@tanstack/solid-query-persist-client';

type IDBPersisterOptions = Readonly<{
  dbName?: string;
  storeName?: string;
  key?: string;
  debounceMs?: number;
}>;

const DEFAULT_DB = 'macro-query-cache';
const DEFAULT_STORE = 'persisted';
const DEFAULT_KEY = 'tanstack';
const DEFAULT_DEBOUNCE_MS = 1000;

const dbCache = new Map<string, IDBDatabase>();

function openDB(dbName: string, storeName: string): Promise<IDBDatabase> {
  const cached = dbCache.get(dbName);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      dbCache.set(dbName, db);
      resolve(db);
    };
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
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createIDBPersister(
  options: IDBPersisterOptions = {}
): Persister {
  const dbName = options.dbName ?? DEFAULT_DB;
  const storeName = options.storeName ?? DEFAULT_STORE;
  const key = options.key ?? DEFAULT_KEY;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  let pendingClient: PersistedClient | null = null;
  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  const flushPersist = async () => {
    if (!pendingClient) return;
    const client = pendingClient;
    pendingClient = null;
    await withStore(dbName, storeName, 'readwrite', (store) =>
      store.put(client, key)
    );
  };

  return {
    persistClient: async (client: PersistedClient) => {
      pendingClient = client;
      if (debounceTimer) clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        debounceTimer = null;
        flushPersist();
      }, debounceMs);
    },
    restoreClient: async () => {
      const value = await withStore<PersistedClient | undefined>(
        dbName,
        storeName,
        'readonly',
        (store) => store.get(key)
      );
      return value;
    },
    removeClient: async () => {
      if (debounceTimer) {
        clearTimeout(debounceTimer);
        debounceTimer = null;
        pendingClient = null;
      }
      await withStore(dbName, storeName, 'readwrite', (store) =>
        store.delete(key)
      );
    },
  };
}
