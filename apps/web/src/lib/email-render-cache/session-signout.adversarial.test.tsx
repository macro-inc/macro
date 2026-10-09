/**
 * Round-2 adversarial tests for the provider's sign-out handling.
 *
 * Every "tab" is a separate Solid root in one realm. The invalidation
 * lifecycle is replaced with an equivalent that remembers which tab
 * registered which listener, so one tab's clearLocalAuthSession() can be
 * modelled without also running the other tabs' listeners (in a browser each
 * tab has its own module instance).
 */
import { webcrypto } from 'node:crypto';
import { type Accessor, createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Listener = (reason: 'reset' | 'local' | 'session-ended') => Promise<void>;

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  flag: vi.fn(),
  logout: vi.fn(async () => {}),
  listeners: [] as Listener[],
  caches: [] as {
    options: { store?: () => Promise<unknown> };
    disposed: boolean;
  }[],
  stores: [] as { name: string; budget: number; closed: boolean }[],
  resetListeners: [] as (() => Promise<void>)[],
}));

vi.mock('./lifecycle', () => ({
  registerEmailRenderInvalidation(listener: Listener) {
    mocks.listeners.push(listener);
    return () => {
      const index = mocks.listeners.indexOf(listener);
      if (index >= 0) mocks.listeners.splice(index, 1);
    };
  },
  async invalidateEmailRenders(reason: Parameters<Listener>[0] = 'reset') {
    await Promise.allSettled(mocks.listeners.map((l) => l(reason)));
  },
}));
vi.mock('@app/features/email-thread/preparation-adapter', () => ({
  prepareEmailThreads: () => () => {},
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.flag(),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableEmailRenderCache: {} }));
vi.mock('@core/context/user', () => ({ useUserContext: () => mocks.user() }));
vi.mock('@core/auth/logout', () => ({ clearLocalAuthSession: mocks.logout }));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: () => () => false,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/util/platform', () => ({ isTauri: () => false }));
vi.mock('@graphql-cache/lifecycle', () => ({
  // Captured so a test can model the normalized-cache worker's cross-tab
  // 'cache-changed' reset; by default nothing fires it (cache host inactive).
  registerCacheResetListener: (listener: () => Promise<void>) => {
    mocks.resetListeners.push(listener);
    return () => {};
  },
}));
vi.mock('@graphql-cache/scope', () => ({
  getOrCreateCacheScope: () => 'test-profile',
}));
vi.mock('./executor', () => ({ createPreparationExecutor: () => ({}) }));
vi.mock('./service', () => ({
  EmailRenderCache: class {
    record: (typeof mocks.caches)[number];
    constructor(options: { store?: () => Promise<unknown> }) {
      this.record = { options, disposed: false };
      mocks.caches.push(this.record);
    }
    dispose() {
      this.record.disposed = true;
    }
    initializeStorage() {}
  },
}));
vi.mock('./indexeddb', () => ({
  artifactDatabaseMayExist: async () => true,
  IndexedDbArtifacts: class {
    record: (typeof mocks.stores)[number];
    constructor(name: string, budget: number) {
      this.record = { name, budget, closed: false };
      mocks.stores.push(this.record);
    }
    async invalidate() {}
    close() {
      this.record.closed = true;
    }
  },
}));

import { digest } from './keys';
import { EmailRenderCacheProvider, useEmailRenderCache } from './session';

class Bus {
  static open = new Set<Bus>();
  static posted: unknown[] = [];
  onmessage?: (event: MessageEvent<unknown>) => void;
  closed = false;
  constructor(readonly name: string) {
    Bus.open.add(this);
  }
  postMessage(data: unknown) {
    Bus.posted.push(data);
    for (const target of Bus.open) {
      if (target === this || target.name !== this.name) continue;
      setTimeout(() => {
        if (!target.closed)
          target.onmessage?.({
            data: structuredClone(data),
          } as MessageEvent<unknown>);
      }, 0);
    }
  }
  close() {
    this.closed = true;
    Bus.open.delete(this);
  }
}

const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await sleep(5);
}
const listening = () =>
  [...Bus.open].filter((channel) => channel.onmessage).length;

const roots: (() => void)[] = [];
function mountTab(userId: string) {
  const [authenticated, setAuthenticated] = createSignal<boolean | undefined>(
    true
  );
  const [id, setId] = createSignal<string | undefined>(userId);
  mocks.user.mockReturnValueOnce({
    isAuthenticated: authenticated,
    userId: id,
  });
  const [flag] = createSignal({ enabled: true, loading: false });
  mocks.flag.mockReturnValueOnce(flag);
  let current: unknown;
  function Capture() {
    const cache = useEmailRenderCache() as Accessor<unknown>;
    createEffect(() => {
      current = cache();
    });
    return null;
  }
  const listenerIndex = mocks.listeners.length;
  const dispose = render(
    () => (
      <EmailRenderCacheProvider>
        <Capture />
      </EmailRenderCacheProvider>
    ),
    document.createElement('div')
  );
  roots.push(dispose);
  return {
    read: () => current,
    setAuthenticated,
    setId,
    /** This tab's own clearLocalAuthSession(), as logout.ts runs it. */
    async clearLocalAuthSession() {
      const clearing = mocks.listeners[listenerIndex]('session-ended');
      localStorage.removeItem('macro:login');
      // Every *other* tab observes the marker removal.
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'macro:login', newValue: null })
      );
      await clearing;
    },
  };
}

/** Another tab (not modelled as a root) signs in: the marker becomes 'true'. */
function signInElsewhere() {
  localStorage.setItem('macro:login', 'true');
  window.dispatchEvent(
    new StorageEvent('storage', { key: 'macro:login', newValue: 'true' })
  );
}

function postFromOtherTab(message: unknown) {
  const name = [...Bus.open][0]?.name;
  if (!name) throw new Error('no session channel');
  const sender = new Bus(name);
  sender.postMessage(message);
  sender.close();
}

const namespaceOf = (viewerId: string) =>
  digest(JSON.stringify([location.origin, 'test', 'test-profile', viewerId]));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.listeners.length = 0;
  mocks.caches.length = 0;
  mocks.stores.length = 0;
  mocks.resetListeners.length = 0;
  Bus.open.clear();
  Bus.posted = [];
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('BroadcastChannel', Bus);
  vi.stubGlobal('indexedDB', {});
  localStorage.setItem('macro:login', 'true');
});

afterEach(async () => {
  roots.splice(0).forEach((dispose) => dispose());
  await settle(4);
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('sign-out reaches other tabs', () => {
  it('sanity: an explicit sign-out while authenticated broadcasts the session end', async () => {
    const a = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(1));
    await a.clearLocalAuthSession();
    await settle(2);
    expect(Bus.posted).toContainEqual({
      kind: 'invalidate',
      sessionEnded: true,
    });
  });

  it('a confirmed session-expired sign-out (BasePath -> clearLocalAuthSession after a 401) tells other tabs the session ended', async () => {
    const a = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(1));
    // user-info answers UNAUTHORIZED: isAuthenticated() is false in tab A.
    a.setAuthenticated(false);
    await settle(2);
    // SessionExpiredRedirect confirms with a fresh refresh, then signs out.
    await a.clearLocalAuthSession();
    await settle(2);
    // Only a plain reset went out (from the 401 disposal). The confirmed
    // sign-out itself is silent because resetCurrent was already undefined.
    expect(Bus.posted).toContainEqual({
      kind: 'invalidate',
      sessionEnded: true,
    });
  });

  it('a second tab stops persisting the signed-out account after a session-expired sign-out', async () => {
    const a = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(1));
    const b = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(2));
    expect(b.read()).toBeDefined();
    // Tab A sees the 401 first. Its disposal broadcasts a plain reset, so tab
    // B rebinds a fresh session while the login marker is still present
    // (SessionExpiredRedirect is still confirming with the server).
    a.setAuthenticated(false);
    await settle();
    const bCache = mocks.caches.at(-1)!;
    expect(bCache.disposed).toBe(false);
    // EmailRenderCache.initializeStorage() opens the persistent tier at once.
    const store = await bCache.options.store?.();
    expect(store, 'B opened persistent storage').toBeDefined();
    // The server confirms: tab A runs clearLocalAuthSession().
    await a.clearLocalAuthSession();
    await settle();
    // B was never told. It still serves a cache and its artifact store for
    // alice stays open (writes continue) after the device signed out.
    expect(b.read(), 'tab B still caches for the signed-out account').toBe(
      undefined
    );
    expect(
      mocks.stores.find((record) => !record.closed),
      'an artifact store for the signed-out account remains open'
    ).toBeUndefined();
  });
});

describe('scope of the session-expired gap', () => {
  it('holds only when the normalized-cache worker broadcasts its reset: the second tab then pins via the local path', async () => {
    const a = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(1));
    const b = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(2));
    a.setAuthenticated(false);
    await settle();
    await a.clearLocalAuthSession();
    // clearRegisteredCaches() -> SharedWorker clear -> 'cache-changed' reset
    // pushed to every tab -> notifyCacheIdentityReset() in tab B.
    await mocks.resetListeners[1]?.();
    await settle();
    expect(b.read()).toBeUndefined();
  });
});

describe('re-enabling a pinned identity', () => {
  it('sanity: a remote sign-out stops caching for that identity', async () => {
    const b = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(1));
    localStorage.removeItem('macro:login');
    postFromOtherTab({ kind: 'invalidate', sessionEnded: true });
    await settle();
    expect(b.read()).toBeUndefined();
  });

  it('another account signing in elsewhere does not resume persisting the signed-out account in this tab', async () => {
    const b = mountTab('alice');
    await vi.waitFor(() => expect(listening()).toBe(1));
    // Alice signs out in tab A.
    localStorage.removeItem('macro:login');
    postFromOtherTab({ kind: 'invalidate', sessionEnded: true });
    await settle();
    expect(b.read()).toBeUndefined();
    const before = mocks.caches.length;
    // Bob signs in in tab A. Tab B has not refetched user info and still
    // believes it is alice; the storage event carries no identity.
    signInElsewhere();
    await settle();
    // A new session was created for alice, and its persistent tier opens
    // because the device marker (bob's) says "signed in".
    const created = mocks.caches.slice(before);
    const opened: (typeof mocks.stores)[number][] = [];
    for (const cache of created) {
      const store = (await cache.options.store?.()) as
        | { record: (typeof mocks.stores)[number] }
        | undefined;
      if (store) opened.push(store.record);
    }
    const aliceNamespace = await namespaceOf('alice');
    expect(
      opened.filter((store) => store.name === aliceNamespace),
      "alice's artifact store reopened after alice signed out"
    ).toEqual([]);
  });
});
