/**
 * Round-2 adversarial checks against session-runtime: the isSignedIn gate,
 * stale-generation healing, clear modes and the Web Locks ordering.
 */
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { IndexedDbArtifacts } from './indexeddb';
import { digest } from './keys';
import {
  createEmailRenderSession,
  type EmailRenderSessionOptions,
} from './session-runtime';

const request = (n: number) => ({
  messageId: `message-${n}`,
  threadId: 'thread',
  mailboxId: 'inbox',
  input: { html: `<p>Body ${n}</p>` },
  options: {},
});

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

/** Keys of persisted artifacts, read directly from the backing factory. */
async function persisted(): Promise<string[]> {
  const name = `macro-email-renders-${await namespace()}`;
  if (!(await factory.databases()).some((db) => db.name === name)) return [];
  const db = await new Promise<IDBDatabase>((resolve, reject) => {
    const open = factory.open(name);
    open.onsuccess = () => resolve(open.result);
    open.onerror = () => reject(open.error);
  });
  try {
    return await new Promise<string[]>((resolve, reject) => {
      const all = db.transaction('artifacts').objectStore('artifacts').getAll();
      all.onsuccess = () =>
        resolve(
          (all.result as { body: { html: string } }[]).map(
            (value) => value.body.html
          )
        );
      all.onerror = () => reject(all.error);
    });
  } finally {
    db.close();
  }
}

async function prepare(session: ReturnType<typeof start>, n: number) {
  const lease = session.cache.acquire(request(n));
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
  for (const session of sessions.splice(0))
    await session.dispose().catch(() => {});
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('holds since mayPersist (failed against the reviewed fix set): a session whose storage is already open stops persisting once the device signs out', async () => {
  // isSignedIn() is consulted when storage opens and when the channel
  // connects, never again. A sign-out that sends this session no session-end
  // broadcast (it was missed, or the signing-out tab had no session, as in
  // the expired-session flow) and leaves the generation current (no clear, or
  // a clear that failed) is invisible to it: it persists bodies for an
  // identity the device has signed out of.
  let signedIn = true;
  const session = start({ isSignedIn: () => signedIn });
  await prepare(session, 1);
  expect(await persisted()).toEqual(['<p>Body 1</p>']);
  signedIn = false; // clearLocalAuthSession(): login cookie + marker removed
  await prepare(session, 2);
  expect(await persisted()).toEqual(['<p>Body 1</p>']);
});

it('holds since mayPersist (failed against the reviewed fix set): a tab that missed a sign-out stops persisting even when the signing-out clear failed', async () => {
  // EmailRenderSessionOptions.isSignedIn: "A tab that missed a sign-out
  // broadcast still must not persist for an identity the device has signed
  // out of." The generation check is the only write-time guard, and a failed
  // clear (quarantined) does not move the generation.
  let signedIn = true;
  const stale = start({ isSignedIn: () => signedIn });
  await prepare(stale, 1);
  // Another tab signs out; its IndexedDB reset fails, so it quarantines.
  vi.spyOn(IndexedDbArtifacts.prototype, 'invalidate').mockRejectedValueOnce(
    new DOMException('denied', 'UnknownError')
  );
  signedIn = false;
  await start({ isSignedIn: () => signedIn }).invalidate(true);
  expect(values.size).toBe(1); // quarantined
  // The fake channel never delivers, as for a missed broadcast.
  await prepare(stale, 2);
  expect(await persisted()).toEqual(['<p>Body 1</p>']);
});

it('holds: a missed invalidation heals on the next write and the successor does not reopen a signed-out namespace', async () => {
  let signedIn = true;
  const notify = vi.fn<EmailRenderSessionOptions['onRemoteInvalidation']>();
  const stale = start({
    isSignedIn: () => signedIn,
    onRemoteInvalidation: notify,
  });
  await prepare(stale, 1);
  signedIn = false;
  await start({ isSignedIn: () => signedIn }).invalidate(true);
  const lease = stale.cache.acquire(request(2));
  await lease.promise;
  lease.release();
  // Either the stale generation (reset) or the write-time sign-in gate
  // (session end) may report first; both stop the session.
  await vi.waitFor(() => expect(notify).toHaveBeenCalled());
  await Promise.all(notify.mock.calls.map(([, clearing]) => clearing));
  expect(await persisted()).toEqual([]);
  // The provider's successor session sees the device signed out.
  const successorEnded = vi.fn();
  const successor = start({
    isSignedIn: () => signedIn,
    onRemoteInvalidation: successorEnded,
  });
  await vi.waitFor(() =>
    expect(successorEnded).toHaveBeenCalledWith(true, expect.any(Promise))
  );
  expect(() => successor.cache.acquire(request(3))).toThrow('cancelled');
  expect(await persisted()).toEqual([]);
});

it('holds since reportRemote (failed against the reviewed fix set): one session reports its end at most once (connect-time check, then the broadcast)', async () => {
  // The provider disposes synchronously on the first report, so this only
  // matters to other embedders; the broadcast handler checks `disposed` but
  // not `invalidated`.
  const notify = vi.fn<EmailRenderSessionOptions['onRemoteInvalidation']>();
  start({ isSignedIn: () => false, onRemoteInvalidation: notify });
  await vi.waitFor(() => expect(notify).toHaveBeenCalledOnce());
  Channel.instances[0].onmessage?.({
    data: { kind: 'invalidate', sessionEnded: true },
  } as MessageEvent);
  expect(notify).toHaveBeenCalledOnce();
});

/** A minimal, faithful Web Locks manager: FIFO, shared/exclusive, signals. */
function installLocks() {
  type Request = {
    name: string;
    mode: LockMode;
    grant: () => void;
  };
  const held: { name: string; mode: LockMode }[] = [];
  const queue: Request[] = [];
  const pump = () => {
    for (let i = 0; i < queue.length; i++) {
      const next = queue[i];
      const same = held.filter((lock) => lock.name === next.name);
      const earlier = queue
        .slice(0, i)
        .some((other) => other.name === next.name);
      const compatible =
        !earlier &&
        (next.mode === 'shared'
          ? same.every((lock) => lock.mode === 'shared')
          : same.length === 0);
      if (!compatible) continue;
      queue.splice(i, 1);
      i--;
      next.grant();
    }
  };
  const locks = {
    request(
      name: string,
      opts: { mode?: LockMode; signal?: AbortSignal },
      work: () => Promise<unknown>
    ) {
      return new Promise((resolve, reject) => {
        const mode = opts.mode ?? 'exclusive';
        const entry: Request = {
          name,
          mode,
          grant: () => {
            const lock = { name, mode };
            held.push(lock);
            void (async () => {
              try {
                resolve(await work());
              } catch (error) {
                reject(error);
              } finally {
                held.splice(held.indexOf(lock), 1);
                pump();
              }
            })();
          },
        };
        opts.signal?.addEventListener('abort', () => {
          const index = queue.indexOf(entry);
          if (index < 0) return;
          queue.splice(index, 1);
          reject(opts.signal?.reason);
          pump();
        });
        queue.push(entry);
        pump();
      });
    },
  };
  vi.stubGlobal('navigator', {
    storage: { estimate: async () => ({ quota: 1024 ** 3, usage: 0 }) },
    locks,
  });
  return locks;
}

it('holds: an opener waits out a clear in progress elsewhere and then persists', async () => {
  const locks = installLocks();
  const name = await namespace();
  // Another tab is mid-clear: it holds the exclusive lock and quarantined.
  const release = Promise.withResolvers<void>();
  const other = locks.request(
    `email-render-clear:${name}`,
    { mode: 'exclusive' },
    () => release.promise
  );
  values.set(`email-render-quarantine:${name}`, '1');
  const session = start();
  const lease = session.cache.acquire(request(1));
  await lease.promise; // the foreground body never waits for the lock
  lease.release();
  await sleep(50);
  values.delete(`email-render-quarantine:${name}`);
  release.resolve();
  await other;
  await vi.waitFor(async () =>
    expect(await persisted()).toEqual(['<p>Body 1</p>'])
  );
});

it('holds: clears and openers in one tab never deadlock on the clear lock', async () => {
  installLocks();
  let barrier: Promise<unknown> = Promise.resolve();
  const join = (work: Promise<unknown>) => {
    barrier = Promise.allSettled([barrier, work]);
  };
  // A provider-like chain: each successor waits on every earlier clear.
  let session = start({ waitForInvalidation: () => barrier });
  await prepare(session, 1);
  for (let i = 0; i < 5; i++) {
    join(i % 2 ? session.invalidate() : session.invalidate(false, false));
    session = start({ waitForInvalidation: () => barrier });
  }
  await prepare(session, 2);
  await vi.waitFor(async () =>
    expect(await persisted()).toEqual(['<p>Body 2</p>'])
  );
});
