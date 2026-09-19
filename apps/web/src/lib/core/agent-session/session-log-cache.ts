/**
 * Last-known agent-session logs, kept in IndexedDB so a reopen can fold
 * before the network answers.
 *
 * The cache stores the protocol frames themselves (`direction` + ACP
 * `content`), not the folded transcript. Folding is cheap once wasm is
 * warm; the frames stay valid across fold-schema changes, and they are
 * what a snapshot already is.
 */

import type {
  AgentSessionLogEntryDto,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';

export const SESSION_LOG_CACHE_VERSION = 1;

export type CachedSessionLog = {
  version: typeof SESSION_LOG_CACHE_VERSION;
  sessionId: string;
  session: AgentSessionResponse;
  bot: SessionBot;
  entries: AgentSessionLogEntryDto[];
};

const DB_NAME = 'agent-session-logs-persist-v1';
const STORE_NAME = 'logs';
const DEFAULT_DEBOUNCE_MS = 250;

const memory = new Map<string, CachedSessionLog>();
const pendingPuts = new Map<string, CachedSessionLog>();
const pendingDeletes = new Set<string>();

let db: IDBDatabase | undefined;
let timer: ReturnType<typeof setTimeout> | null = null;
let flushLock = false;
let flushAgain = false;

function isCachedSessionLog(value: unknown): value is CachedSessionLog {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<CachedSessionLog>;
  return (
    entry.version === SESSION_LOG_CACHE_VERSION &&
    typeof entry.sessionId === 'string' &&
    entry.sessionId.length > 0 &&
    entry.session !== undefined &&
    entry.bot !== undefined &&
    Array.isArray(entry.entries)
  );
}

function persistable(sessionId: string): boolean {
  // Placeholders are minted before POST; they are never a real log.
  return !sessionId.startsWith('pending-');
}

function openDB(): Promise<IDBDatabase | undefined> {
  if (db) return Promise.resolve(db);
  const factory = globalThis.indexedDB;
  if (!factory) return Promise.resolve(undefined);

  return new Promise((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.open(DB_NAME, 1);
    } catch {
      resolve(undefined);
      return;
    }
    request.onupgradeneeded = () => {
      const next = request.result;
      if (!next.objectStoreNames.contains(STORE_NAME)) {
        next.createObjectStore(STORE_NAME);
      }
    };
    request.onsuccess = () => {
      const next = request.result;
      next.onclose = () => {
        if (db === next) db = undefined;
      };
      db = next;
      resolve(next);
    };
    request.onerror = () => resolve(undefined);
    request.onblocked = () => resolve(undefined);
  });
}

function closeDB(): void {
  db?.close();
  db = undefined;
}

async function withStore<T>(
  mode: IDBTransactionMode,
  fn: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T | undefined> {
  const opened = await openDB();
  if (!opened) return undefined;
  return new Promise((resolve) => {
    try {
      const tx = opened.transaction(STORE_NAME, mode);
      const request = fn(tx.objectStore(STORE_NAME));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => resolve(undefined);
      tx.onabort = () => resolve(undefined);
    } catch {
      resolve(undefined);
    }
  });
}

async function flush(): Promise<void> {
  const puts = new Map(pendingPuts);
  const deletes = new Set(pendingDeletes);
  pendingPuts.clear();
  pendingDeletes.clear();
  if (puts.size === 0 && deletes.size === 0) return;

  const opened = await openDB();
  if (!opened) return;

  await new Promise<void>((resolve) => {
    try {
      const tx = opened.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      for (const [sessionId, entry] of puts) store.put(entry, sessionId);
      for (const sessionId of deletes) store.delete(sessionId);
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
      tx.onabort = () => resolve();
    } catch {
      resolve();
    }
  });
}

async function runFlush(): Promise<void> {
  if (flushLock) {
    flushAgain = true;
    return;
  }
  flushLock = true;
  try {
    do {
      flushAgain = false;
      await flush();
    } while (flushAgain);
  } finally {
    flushLock = false;
  }
}

function scheduleFlush(): void {
  if (timer) return;
  timer = setTimeout(() => {
    timer = null;
    void runFlush();
  }, DEFAULT_DEBOUNCE_MS);
}

/**
 * The last log we folded for `sessionId`, or `undefined` when nothing is
 * cached. Memory first, then IDB; a corrupt or version-mismatched row is
 * treated as a miss.
 */
export async function readCachedSessionLog(
  sessionId: string
): Promise<CachedSessionLog | undefined> {
  if (!persistable(sessionId)) return undefined;
  const cached = memory.get(sessionId);
  if (cached) return cached;

  let stored: unknown;
  try {
    stored = await withStore('readonly', (store) => store.get(sessionId));
  } catch {
    return undefined;
  }
  if (!isCachedSessionLog(stored) || stored.sessionId !== sessionId) {
    return undefined;
  }
  memory.set(sessionId, stored);
  return stored;
}

/** Remember a log. Memory is updated now; IDB writes are coalesced. */
export function writeCachedSessionLog(entry: CachedSessionLog): void {
  if (!persistable(entry.sessionId)) return;
  if (entry.version !== SESSION_LOG_CACHE_VERSION) return;
  memory.set(entry.sessionId, entry);
  pendingDeletes.delete(entry.sessionId);
  pendingPuts.set(entry.sessionId, entry);
  scheduleFlush();
}

export function removeCachedSessionLog(sessionId: string): void {
  memory.delete(sessionId);
  pendingPuts.delete(sessionId);
  pendingDeletes.add(sessionId);
  scheduleFlush();
}

/** Push pending writes now. Used on release and when the tab hides. */
export async function flushCachedSessionLogs(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  await runFlush();
}

/** Drop every cached log. Logout, so the next account cannot see these. */
export async function clearCachedSessionLogs(): Promise<void> {
  memory.clear();
  pendingPuts.clear();
  pendingDeletes.clear();
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  closeDB();

  const factory = globalThis.indexedDB;
  if (!factory) return;
  await new Promise<void>((resolve) => {
    let request: IDBOpenDBRequest;
    try {
      request = factory.deleteDatabase(DB_NAME);
    } catch {
      resolve();
      return;
    }
    request.onsuccess = () => resolve();
    request.onerror = () => resolve();
    request.onblocked = () => resolve();
  });
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      void flushCachedSessionLogs();
    }
  });
}
