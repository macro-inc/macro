import type { QueryKey } from '@tanstack/query-core';

export type PersistedQueryEntry = Readonly<{
  queryHash: string;
  queryKey: QueryKey;
  data: unknown;
  dataUpdatedAt: number;
  persistedAt: number;
  buster: string;
}>;

export type PerQueryPersistence = {
  get: (queryHash: string) => Promise<PersistedQueryEntry | undefined>;
  set: (entry: PersistedQueryEntry) => void;
  remove: (queryHash: string) => void;
  flush: () => Promise<void>;
};

type PerQueryPersistenceOptions = Readonly<{
  dbName: string;
  debounceMs?: number;
}>;

const STORE_NAME = 'queries';
const DEFAULT_DEBOUNCE_MS = 1000;

const dbCache = new Map<string, IDBDatabase>();

function openDB(dbName: string): Promise<IDBDatabase> {
  const cached = dbCache.get(dbName);
  if (cached) return Promise.resolve(cached);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onclose = () => dbCache.delete(dbName);
      dbCache.set(dbName, db);
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(
  dbName: string,
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await openDB(dbName);
  return new Promise<T>((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, mode);
    const store = tx.objectStore(STORE_NAME);
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    tx.onabort = () => reject(tx.error);
  });
}

export function createPerQueryIDBStore(
  options: PerQueryPersistenceOptions
): PerQueryPersistence {
  const { dbName } = options;
  const debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;

  const pendingPuts = new Map<string, PersistedQueryEntry>();
  const pendingDeletes = new Set<string>();
  let timer: ReturnType<typeof setTimeout> | null = null;

  const flush = async () => {
    const puts = new Map(pendingPuts);
    const deletes = new Set(pendingDeletes);
    pendingPuts.clear();
    pendingDeletes.clear();

    if (puts.size === 0 && deletes.size === 0) return;

    try {
      const db = await openDB(dbName);
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);

      for (const [hash, entry] of puts) {
        store.put(entry, hash);
      }
      for (const hash of deletes) {
        store.delete(hash);
      }

      await new Promise<void>((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      });
    } catch (err) {
      for (const [hash, entry] of puts) {
        if (!pendingPuts.has(hash)) pendingPuts.set(hash, entry);
      }
      for (const hash of deletes) {
        if (!pendingPuts.has(hash)) pendingDeletes.add(hash);
      }
      console.error('[query] IDB persistence flush failed', err);
    }
  };

  const scheduleFlush = () => {
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      void flush();
    }, debounceMs);
  };

  return {
    get: (queryHash) =>
      withStore<PersistedQueryEntry | undefined>(dbName, 'readonly', (store) =>
        store.get(queryHash)
      ),

    set: (entry) => {
      pendingDeletes.delete(entry.queryHash);
      pendingPuts.set(entry.queryHash, entry);
      scheduleFlush();
    },

    remove: (queryHash) => {
      pendingPuts.delete(queryHash);
      pendingDeletes.add(queryHash);
      scheduleFlush();
    },

    flush: async () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      await flush();
    },
  };
}
