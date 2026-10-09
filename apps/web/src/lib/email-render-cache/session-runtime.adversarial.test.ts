import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IndexedDbArtifacts } from './indexeddb';
import { digest } from './keys';
import {
  createEmailRenderSession,
  type EmailRenderSessionOptions,
} from './session-runtime';

const request = {
  messageId: 'message',
  threadId: 'thread',
  mailboxId: 'inbox',
  input: { html: '<p>Body</p>' },
  options: {},
};

class Channel {
  static instances: Channel[] = [];
  onmessage?: (event: MessageEvent<unknown>) => void;
  postMessage = vi.fn();
  close = vi.fn();
  constructor(readonly name: string) {
    Channel.instances.push(this);
  }
}

const sessions: ReturnType<typeof createEmailRenderSession>[] = [];
const values = new Map<string, string>();
let factory: IDBFactory;

const options = (): EmailRenderSessionOptions => ({
  origin: 'https://mail.example',
  environment: 'test',
  profileScope: 'profile',
  viewerId: 'viewer',
  enabled: true,
  native: false,
  mobile: false,
  waitForInvalidation: async () => {},
  onRemoteInvalidation() {},
});

const namespace = () =>
  digest(JSON.stringify(['https://mail.example', 'test', 'profile', 'viewer']));
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));

function start(overrides: Partial<EmailRenderSessionOptions> = {}) {
  const session = createEmailRenderSession({ ...options(), ...overrides });
  sessions.push(session);
  return session;
}

async function databaseNames(): Promise<string[]> {
  return (await factory.databases()).map((database) => database.name ?? '');
}

/** Number of persisted artifacts, read directly from the backing factory. */
async function artifactCount(): Promise<number> {
  const name = `macro-email-renders-${await namespace()}`;
  if (!(await databaseNames()).includes(name)) return 0;
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<number>((resolve, reject) => {
      const count = db
        .transaction('artifacts')
        .objectStore('artifacts')
        .count();
      count.onsuccess = () => resolve(count.result);
      count.onerror = () => reject(count.error);
    });
  } finally {
    db.close();
  }
}

async function prepareOnce(session: ReturnType<typeof start>) {
  const lease = session.cache.acquire(request);
  await lease.promise;
  lease.release();
  // save() persists on a zero-delay timer after delivery.
  await sleep(50);
}

beforeEach(() => {
  Channel.instances = [];
  values.clear();
  factory = new IDBFactory();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('BroadcastChannel', Channel);
  vi.stubGlobal('navigator', {
    storage: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }) },
  });
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
    removeItem: (key: string) => values.delete(key),
  });
});

afterEach(async () => {
  for (const session of sessions.splice(0)) await session.dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('sanity: an enabled session persists a prepared body', async () => {
  const session = start();
  await prepareOnce(session);
  expect(await artifactCount()).toBe(1);
});

it('holds (fixed in working tree; failed at HEAD 62c87c7e10): a session created behind a predecessor clear slower than 150 ms still persists', async () => {
  // Session 1 has artifacts; its clear (an IndexedDB reset transaction) is
  // slowed to 200 ms, as with a large artifact store or a busy disk.
  const first = start();
  await prepareOnce(first);
  expect(await artifactCount()).toBe(1);
  const reset = IndexedDbArtifacts.prototype.invalidate;
  vi.spyOn(IndexedDbArtifacts.prototype, 'invalidate').mockImplementation(
    async function (this: IndexedDbArtifacts) {
      await sleep(200);
      return await reset.call(this);
    }
  );
  // The provider creates the successor immediately and gates its storage
  // opener on the barrier, as session.tsx does after setEpoch().
  const clearing = first.invalidate();
  const second = start({ waitForInvalidation: () => clearing });
  await clearing;
  expect(await artifactCount()).toBe(0);
  // Long after the clear finished, the successor still runs memory-only:
  // openStorage() timed out at 150 ms and cached `undefined` for its lifetime.
  await sleep(100);
  await prepareOnce(second);
  expect(await artifactCount()).toBe(1);
});

it('a disabled session does not create the artifact database when indexedDB.databases() is unavailable', async () => {
  // e.g. Firefox before 126 (incl. ESR 115) has no IDBFactory.databases().
  vi.stubGlobal('indexedDB', {
    open: factory.open.bind(factory),
    deleteDatabase: factory.deleteDatabase.bind(factory),
    cmp: factory.cmp.bind(factory),
  });
  const session = start({ enabled: false });
  await session.invalidate(); // a delete_message / link_removed event
  await session.invalidate(true);
  expect(await databaseNames()).toHaveLength(0);
});

it('a disabled session does not create the artifact database when indexedDB.databases() is slower than 500 ms', async () => {
  vi.stubGlobal('indexedDB', {
    open: factory.open.bind(factory),
    deleteDatabase: factory.deleteDatabase.bind(factory),
    cmp: factory.cmp.bind(factory),
    databases: async () => {
      await sleep(600);
      return await factory.databases();
    },
  });
  const session = start({ enabled: false });
  await session.invalidate(true);
  expect(await databaseNames()).toHaveLength(0);
});

it('a disabled session leaves no quarantine key when IndexedDB is unavailable', async () => {
  vi.stubGlobal('indexedDB', undefined);
  const session = start({ enabled: false });
  await session.invalidate(true);
  // Nothing was ever stored, yet a per-viewer key now persists in
  // localStorage (and every later session for this viewer skips storage).
  expect([...values.keys()]).toEqual([]);
});

it('a rejected Web Locks request still clears and quarantines', async () => {
  // navigator.locks.request rejects e.g. for a document that is not fully
  // active or an opaque-origin context. The old code had no lock here.
  await (async () => {
    const seed = new IndexedDbArtifacts(await namespace(), 1024);
    try {
      await seed.generation();
    } finally {
      seed.close();
    }
  })();
  vi.stubGlobal('navigator', {
    storage: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }) },
    locks: {
      request: async () => {
        throw new DOMException('Lock manager unavailable', 'InvalidStateError');
      },
    },
  });
  const session = start({ enabled: false });
  sessions.pop(); // dispose() re-rejects with the same stored clear
  // The rejection also escapes invalidate() (callers in session.tsx wrap it
  // in allSettled, so it is otherwise silent).
  const outcome = await session.invalidate(true).then(
    () => 'resolved',
    (error: Error) => error.message
  );
  vi.stubGlobal('navigator', {
    storage: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }) },
  });
  const check = new IndexedDbArtifacts(await namespace(), 1024);
  try {
    const cleared = (await check.generation()) === 1;
    const quarantined = values.size === 1;
    expect({ outcome, clearedOrQuarantined: cleared || quarantined }).toEqual({
      outcome: 'resolved',
      clearedOrQuarantined: true,
    });
  } finally {
    check.close();
    await session.dispose().catch(() => {});
  }
});

it('holds: logout clearing is bounded when IndexedDB never answers', async () => {
  const stuck = () => {
    const request = {} as IDBOpenDBRequest;
    return request;
  };
  vi.stubGlobal('indexedDB', {
    open: stuck,
    databases: () => new Promise(() => {}),
  });
  const session = start({ enabled: false });
  const startedAt = Date.now();
  await session.invalidate(true);
  const elapsed = Date.now() - startedAt;
  expect(elapsed).toBeLessThan(3000);
  // The failed clear stays quarantined.
  expect(values.size).toBe(1);
}, 10_000);

it('holds: a remote invalidation never re-broadcasts and disposal after it stays silent', async () => {
  const remote = vi.fn<EmailRenderSessionOptions['onRemoteInvalidation']>();
  const session = start({ onRemoteInvalidation: remote });
  await vi.waitFor(() => expect(Channel.instances[0]?.onmessage).toBeDefined());
  for (let i = 0; i < 5; i++)
    Channel.instances[0].onmessage?.({
      data: { kind: 'invalidate', sessionEnded: false },
    } as MessageEvent);
  await Promise.all(remote.mock.calls.map(([, clearing]) => clearing));
  await session.dispose(false);
  for (const channel of Channel.instances)
    expect(channel.postMessage).not.toHaveBeenCalled();
});
