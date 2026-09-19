import type {
  AgentSessionLogEntryDto,
  AgentSessionResponse,
  SessionBot,
} from '@service-agent-harness/generated/schemas';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  clearCachedSessionLogs,
  flushCachedSessionLogs,
  readCachedSessionLog,
  removeCachedSessionLog,
  SESSION_LOG_CACHE_VERSION,
  writeCachedSessionLog,
} from './session-log-cache';

const SESSION = '01a0abed-279f-724c-9f49-60dbedc79b6e';

const bot = { id: 'bot-id', name: 'Agent', handle: 'agent' } as SessionBot;
const session = {
  id: SESSION,
  name: 'A session',
  canEdit: true,
} as AgentSessionResponse;
const entries = [
  {
    id: 'row-1',
    createdAt: '2026-08-13T00:00:00.000Z',
    direction: 'to_server',
    content: { type: 'acp', method: 'session/update' },
  },
] as unknown as AgentSessionLogEntryDto[];

const cached = {
  version: SESSION_LOG_CACHE_VERSION,
  sessionId: SESSION,
  session,
  bot,
  entries,
} as const;

type Handler = ((event: Event) => void) | null;

function requestOf<T>(value: T): IDBRequest<T> {
  const request = {
    result: value,
    error: null,
    onsuccess: null as Handler,
    onerror: null as Handler,
  };
  queueMicrotask(() => {
    request.onsuccess?.call(request, new Event('success'));
  });
  return request as unknown as IDBRequest<T>;
}

function installMemoryIndexedDB() {
  const data = new Map<IDBValidKey, unknown>();

  const store = {
    get: (key: IDBValidKey) => requestOf(data.get(key)),
    put: (value: unknown, key: IDBValidKey) => {
      data.set(key, value);
      return requestOf(undefined);
    },
    delete: (key: IDBValidKey) => {
      data.delete(key);
      return requestOf(undefined);
    },
  };

  const db = {
    objectStoreNames: { contains: () => true },
    transaction: () => {
      const tx = {
        objectStore: () => store,
        oncomplete: null as Handler,
        onerror: null as Handler,
        onabort: null as Handler,
      };
      queueMicrotask(() => {
        tx.oncomplete?.call(tx, new Event('complete'));
      });
      return tx;
    },
    close: vi.fn(),
    onclose: null as Handler,
  };

  const indexedDB = {
    open: vi.fn(() => {
      const request = {
        result: db,
        onupgradeneeded: null as Handler,
        onsuccess: null as Handler,
        onerror: null as Handler,
        onblocked: null as Handler,
      };
      queueMicrotask(() => {
        request.onsuccess?.call(request, new Event('success'));
      });
      return request;
    }),
    deleteDatabase: vi.fn(() => {
      data.clear();
      const request = {
        onsuccess: null as Handler,
        onerror: null as Handler,
        onblocked: null as Handler,
      };
      queueMicrotask(() => {
        request.onsuccess?.call(request, new Event('success'));
      });
      return request;
    }),
  };

  vi.stubGlobal('indexedDB', indexedDB);
  return { data, indexedDB };
}

beforeEach(async () => {
  installMemoryIndexedDB();
  await clearCachedSessionLogs();
});

afterEach(async () => {
  await clearCachedSessionLogs();
  vi.unstubAllGlobals();
});

describe('session-log-cache', () => {
  it('serves a write from memory before IDB flushes', async () => {
    writeCachedSessionLog(cached);
    expect(await readCachedSessionLog(SESSION)).toEqual(cached);
    expect(globalThis.indexedDB.open).not.toHaveBeenCalled();
  });

  it('flushes a write into IDB and reads it back after a memory miss', async () => {
    const { data } = installMemoryIndexedDB();
    writeCachedSessionLog(cached);
    await flushCachedSessionLogs();
    expect(data.get(SESSION)).toEqual(cached);

    await clearCachedSessionLogs();
    data.set(SESSION, cached);
    expect(await readCachedSessionLog(SESSION)).toEqual(cached);
  });

  it('ignores a version-mismatched or placeholder row', async () => {
    writeCachedSessionLog({
      ...cached,
      version: 0 as unknown as typeof SESSION_LOG_CACHE_VERSION,
    });
    expect(await readCachedSessionLog(SESSION)).toBeUndefined();

    writeCachedSessionLog({
      ...cached,
      sessionId: `pending-${SESSION}`,
    });
    expect(await readCachedSessionLog(`pending-${SESSION}`)).toBeUndefined();
  });

  it('drops a removed session from memory', async () => {
    writeCachedSessionLog(cached);
    removeCachedSessionLog(SESSION);
    expect(await readCachedSessionLog(SESSION)).toBeUndefined();
  });

  it('clears every cached log on logout', async () => {
    writeCachedSessionLog(cached);
    await clearCachedSessionLogs();
    expect(await readCachedSessionLog(SESSION)).toBeUndefined();
    expect(globalThis.indexedDB.deleteDatabase).toHaveBeenCalledWith(
      'agent-session-logs-persist-v1'
    );
  });
});
