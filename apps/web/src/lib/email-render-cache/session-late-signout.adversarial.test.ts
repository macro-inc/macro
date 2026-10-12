/**
 * Round-2 adversarial check against the latest provider fix for the
 * session-expired sign-out: `latest?.invalidate(true)` announces the session
 * end from a session that already cleared (and broadcast a reset) when the 401
 * first arrived. Receivers treat a broadcast as `clear('remote')` ("another
 * tab already cleared storage"), but everything they persisted between that
 * earlier clear and the late announcement is never cleared by anyone.
 */
import { webcrypto } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
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

/** Delivers asynchronously to every other open channel of the same name. */
class Bus {
  static open = new Set<Bus>();
  onmessage?: (event: MessageEvent<unknown>) => void;
  constructor(readonly name: string) {
    Bus.open.add(this);
  }
  postMessage(data: unknown) {
    for (const target of Bus.open) {
      if (target === this || target.name !== this.name) continue;
      setTimeout(() => {
        if (Bus.open.has(target))
          target.onmessage?.({
            data: structuredClone(data),
          } as MessageEvent<unknown>);
      }, 0);
    }
  }
  close() {
    Bus.open.delete(this);
  }
}

const sessions: ReturnType<typeof createEmailRenderSession>[] = [];
const values = new Map<string, string>();
let factory: IDBFactory;
let signedIn = true;

const options = (): EmailRenderSessionOptions => ({
  origin: 'https://mail.example',
  environment: 'test',
  profileScope: 'profile',
  viewerId: 'viewer',
  enabled: true,
  native: false,
  mobile: false,
  waitForInvalidation: async () => {},
  isSignedIn: () => signedIn,
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
  await sleep(50);
}

beforeEach(() => {
  Bus.open.clear();
  values.clear();
  signedIn = true;
  factory = new IDBFactory();
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('indexedDB', factory);
  vi.stubGlobal('BroadcastChannel', Bus);
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

it("holds since the 18:36 sender-side re-clear (failed against the 18:31 fix): a late session-end announcement from an already-cleared session clears the other tabs' interim artifacts", async () => {
  // Tab B and tab C both show `viewer`.
  const ended = vi.fn<EmailRenderSessionOptions['onRemoteInvalidation']>();
  let tabC = start({
    onRemoteInvalidation: (sessionEnded, clearing) => {
      ended(sessionEnded, clearing);
      // The provider rebinds on a reset (setEpoch).
      if (!sessionEnded) tabC = start({ onRemoteInvalidation: ended });
    },
  });
  const tabB = start();
  await sleep(20); // channels connected
  await prepare(tabC, 1);

  // 1) B's user-info 401: isAuthenticated() flips false, B's viewer memo
  //    disposes its session -> clear('shared'): reset + broadcast (not ended).
  await tabB.dispose();
  await vi.waitFor(() =>
    expect(ended).toHaveBeenCalledWith(false, expect.any(Promise))
  );
  await ended.mock.calls[0][1];
  expect(await persisted()).toEqual([]);

  // 2) C rebinds and keeps rendering (its own calls have not 401ed yet).
  await sleep(20);
  await prepare(tabC, 2);
  expect(await persisted()).toEqual(['<p>Body 2</p>']);

  // 3) B's SessionExpiredRedirect confirms and runs clearLocalAuthSession():
  //    marker removed, then invalidateEmailRenders('session-ended') reaches
  //    the provider with no current session -> latest?.invalidate(true).
  signedIn = false;
  await tabB.invalidate(true);
  await vi.waitFor(() =>
    expect(ended).toHaveBeenCalledWith(true, expect.any(Promise))
  );
  await Promise.all(ended.mock.calls.map(([, clearing]) => clearing));
  await sleep(50);

  // The sign-out is complete in every tab, yet the signed-out identity's
  // body is still on disk and the namespace is not quarantined.
  expect({
    artifacts: await persisted(),
    quarantined: values.size > 0,
  }).toEqual({ artifacts: [], quarantined: false });
});
