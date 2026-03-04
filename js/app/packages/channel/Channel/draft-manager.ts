import { match } from 'ts-pattern';

export type DraftScope =
  | { type: 'channel-input' }
  | { type: 'thread-reply'; threadId: string }
  | { type: 'message-edit'; messageId: string };

export type DraftRecord<T> = {
  id: string;
  userId: string;
  channelId: string;
  scope: DraftScope;
  value: T;
  updatedAt: number;
  expiresAt: number;
};

export type DraftEvent<T> =
  | { type: 'updated'; value: T; updatedAt: number; source: 'local' | 'remote' }
  | { type: 'cleared'; source: 'local' | 'remote' };

export type DraftSyncMessage =
  | { type: 'updated'; id: string; by: string }
  | { type: 'cleared'; id: string; by: string };

export type DraftSyncChannel = {
  postMessage: (message: DraftSyncMessage) => void;
  onMessage: (listener: (message: DraftSyncMessage) => void) => () => void;
  close: () => void;
};

export type DraftPersistence<T> = {
  get: (id: string) => Promise<DraftRecord<T> | undefined>;
  put: (record: DraftRecord<T>) => Promise<void>;
  delete: (id: string) => Promise<void>;
};

export type ScopedDraftManager<T> = {
  load: () => Promise<T | null>;
  save: (value: T) => void;
  flush: () => Promise<void>;
  clear: () => Promise<void>;
  subscribe: (listener: (event: DraftEvent<T>) => void) => () => void;
};

export type DraftManager<T> = {
  forScope: (scope: DraftScope) => ScopedDraftManager<T>;
  flushAll: () => Promise<void>;
  dispose: () => Promise<void>;
};

export type CreateDraftManagerOptions<T> = {
  userId: string;
  channelId: string;
  ttlMs: number;
  debounceMs: number;
  maxWaitMs?: number;
  isEmpty?: (value: T) => boolean;
  now?: () => number;
  channelName?: string;
  persistence?: DraftPersistence<T>;
  syncChannel?: DraftSyncChannel;
  onError?: (error: unknown) => void;
};

type CreateIndexedDbDraftPersistenceOptions = {
  dbName?: string;
  storeName?: string;
};

type PendingDraft<T> = {
  scope: DraftScope;
  value: T;
  firstQueuedAt: number;
  timer: ReturnType<typeof setTimeout> | null;
};

type DraftPersistenceKey = `${string}-persist-v${number}`;

export function createDraftPersistenceKey(
  name: string,
  version: number
): DraftPersistenceKey {
  return `${name}-persist-v${version}`;
}

export const CHANNEL_DRAFT_DB_VERSION = 1;
const DEFAULT_DB_NAME = createDraftPersistenceKey(
  'channel-drafts',
  CHANNEL_DRAFT_DB_VERSION
);
const DEFAULT_STORE_NAME = 'drafts';
const DEFAULT_CHANNEL_NAME = 'channel-drafts-sync';
const DEFAULT_MAX_WAIT_MS = 2_000;

export function createDraftManager<T>(
  options: CreateDraftManagerOptions<T>
): DraftManager<T> {
  const now = options.now ?? (() => Date.now());
  const maxWaitMs = options.maxWaitMs ?? DEFAULT_MAX_WAIT_MS;
  const onError = options.onError ?? (() => {});
  const persistence =
    options.persistence ?? createIndexedDbDraftPersistence<T>();
  const syncChannel =
    options.syncChannel ??
    createDraftSyncChannel(options.channelName ?? DEFAULT_CHANNEL_NAME);

  const managedScopePrefix = `${options.userId}:${options.channelId}:`;
  const tabId = crypto.randomUUID();
  const pendingById = new Map<string, PendingDraft<T>>();
  const listenersById = new Map<string, Set<(event: DraftEvent<T>) => void>>();

  const stopSyncSubscription = syncChannel.onMessage((message) => {
    if (!message.id.startsWith(managedScopePrefix)) return;
    if (message.by === tabId) return;
    if (pendingById.has(message.id)) return;

    runInBackground(handleSyncMessage(message));
  });

  function forScope(scope: DraftScope): ScopedDraftManager<T> {
    const id = createDraftKey(options.userId, options.channelId, scope);

    return {
      load: async () => {
        const pending = pendingById.get(id);
        if (pending) return pending.value;

        const record = await persistence.get(id);
        if (!record) return null;
        if (record.expiresAt <= now()) {
          await persistence.delete(id);
          return null;
        }
        return record.value;
      },

      save: (value) => {
        if (options.isEmpty?.(value)) {
          runInBackground(clearById(id));
          return;
        }

        const existing = pendingById.get(id);
        const firstQueuedAt = existing?.firstQueuedAt ?? now();
        const shouldFlushNow = now() - firstQueuedAt >= maxWaitMs;

        if (existing?.timer != null) clearTimeout(existing.timer);

        const pending: PendingDraft<T> = {
          scope,
          value,
          firstQueuedAt,
          timer: null,
        };
        pendingById.set(id, pending);

        if (shouldFlushNow) {
          runInBackground(flushById(id));
          return;
        }

        pending.timer = setTimeout(() => {
          runInBackground(flushById(id));
        }, options.debounceMs);
      },

      flush: () => flushById(id),

      clear: () => clearById(id),

      subscribe: (listener) => {
        const listeners = listenersById.get(id) ?? new Set();
        listeners.add(listener);
        listenersById.set(id, listeners);

        return () => {
          const nextListeners = listenersById.get(id);
          if (!nextListeners) return;
          nextListeners.delete(listener);
          if (nextListeners.size === 0) listenersById.delete(id);
        };
      },
    };
  }

  async function handleSyncMessage(message: DraftSyncMessage): Promise<void> {
    if (message.type === 'cleared') {
      emit(message.id, { type: 'cleared', source: 'remote' });
      return;
    }

    const record = await persistence.get(message.id);
    if (!record) return;

    if (record.expiresAt <= now()) {
      await persistence.delete(message.id);
      emit(message.id, { type: 'cleared', source: 'remote' });
      return;
    }

    emit(message.id, {
      type: 'updated',
      value: record.value,
      updatedAt: record.updatedAt,
      source: 'remote',
    });
  }

  async function flushById(id: string): Promise<void> {
    const pending = pendingById.get(id);
    if (!pending) return;

    if (pending.timer != null) clearTimeout(pending.timer);
    pendingById.delete(id);

    const updatedAt = now();
    const record: DraftRecord<T> = {
      id,
      userId: options.userId,
      channelId: options.channelId,
      scope: pending.scope,
      value: pending.value,
      updatedAt,
      expiresAt: updatedAt + options.ttlMs,
    };

    await persistence.put(record);

    emit(id, {
      type: 'updated',
      value: record.value,
      updatedAt: record.updatedAt,
      source: 'local',
    });
    syncChannel.postMessage({ type: 'updated', id, by: tabId });
  }

  async function clearById(id: string): Promise<void> {
    const pending = pendingById.get(id);
    if (pending?.timer != null) clearTimeout(pending.timer);
    pendingById.delete(id);

    await persistence.delete(id);
    emit(id, { type: 'cleared', source: 'local' });
    syncChannel.postMessage({ type: 'cleared', id, by: tabId });
  }

  function emit(id: string, event: DraftEvent<T>) {
    listenersById.get(id)?.forEach((listener) => listener(event));
  }

  function runInBackground(task: Promise<void>) {
    void task.catch(onError);
  }

  return {
    forScope,
    flushAll: async () => {
      const ids = [...pendingById.keys()];
      await Promise.all(ids.map((id) => flushById(id)));
    },
    dispose: async () => {
      await Promise.all([...pendingById.keys()].map((id) => flushById(id)));
      stopSyncSubscription();
      syncChannel.close();
    },
  };
}

export function createDraftKey(
  userId: string,
  channelId: string,
  scope: DraftScope
): string {
  return match(scope)
    .with({ type: 'channel-input' }, () => `${userId}:${channelId}:channel-input`)
    .with(
      { type: 'thread-reply' },
      ({ threadId }) => `${userId}:${channelId}:thread-reply:${threadId}`
    )
    .with(
      { type: 'message-edit' },
      ({ messageId }) => `${userId}:${channelId}:message-edit:${messageId}`
    )
    .exhaustive();
}

export function createIndexedDbDraftPersistence<T>(
  options: CreateIndexedDbDraftPersistenceOptions = {}
): DraftPersistence<T> {
  const dbName = options.dbName ?? DEFAULT_DB_NAME;
  const storeName = options.storeName ?? DEFAULT_STORE_NAME;
  const dbPromise = openDraftDatabase(dbName, storeName);

  return {
    get: (id) =>
      withObjectStore<DraftRecord<T> | undefined>(
        dbPromise,
        storeName,
        'readonly',
        (store) => store.get(id)
      ),
    put: async (record) => {
      await withObjectStore<unknown>(dbPromise, storeName, 'readwrite', (store) =>
        store.put(record)
      );
    },
    delete: async (id) => {
      await withObjectStore<unknown>(dbPromise, storeName, 'readwrite', (store) =>
        store.delete(id)
      );
    },
  };
}

export function createDraftSyncChannel(channelName: string): DraftSyncChannel {
  if (typeof BroadcastChannel === 'undefined') {
    return {
      postMessage: () => {},
      onMessage: () => () => {},
      close: () => {},
    };
  }

  const channel = new BroadcastChannel(channelName);

  return {
    postMessage: (message) => {
      channel.postMessage(message);
    },
    onMessage: (listener) => {
      const handler = (event: MessageEvent<unknown>) => {
        if (!isDraftSyncMessage(event.data)) return;
        listener(event.data);
      };

      channel.addEventListener('message', handler);
      return () => {
        channel.removeEventListener('message', handler);
      };
    },
    close: () => {
      channel.close();
    },
  };
}

function isDraftSyncMessage(value: unknown): value is DraftSyncMessage {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<DraftSyncMessage>;
  const hasType = candidate.type === 'updated' || candidate.type === 'cleared';
  return hasType && typeof candidate.id === 'string' && typeof candidate.by === 'string';
}

function openDraftDatabase(
  dbName: string,
  storeName: string
): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName, 1);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withObjectStore<T>(
  dbPromise: Promise<IDBDatabase>,
  storeName: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> {
  const db = await dbPromise;
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const request = operation(store);

    let settled = false;
    const resolveOnce = (value: T) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const rejectOnce = (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error);
    };

    tx.oncomplete = () => {
      resolveOnce(request.result);
    };
    tx.onerror = () => {
      rejectOnce(tx.error ?? new Error('IndexedDB transaction failed'));
    };
    tx.onabort = () => {
      rejectOnce(tx.error ?? new Error('IndexedDB transaction aborted'));
    };
    request.onerror = () => {
      rejectOnce(request.error ?? new Error('IndexedDB request failed'));
    };
  });
}
