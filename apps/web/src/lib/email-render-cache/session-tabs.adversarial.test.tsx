import { webcrypto } from 'node:crypto';
import { type Accessor, createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateEmailRenders } from './lifecycle';
import { EmailRenderCacheProvider, useEmailRenderCache } from './session';

/**
 * Adversarial multi-"tab" tests. Every tab is a separate Solid root with its
 * own user context and flag, sharing one realm. Module-level invalidation
 * listeners are therefore shared, which models "every tab receives the same
 * websocket event". A spec-faithful fake BroadcastChannel delivers to every
 * other channel of the same name that is open at post time, asynchronously,
 * and drops delivery to channels closed before the task runs.
 */

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  flag: vi.fn(),
  caches: 0,
  idbInvalidations: 0,
  logout: vi.fn(async () => {}),
  release: vi.fn(),
  prepare: vi.fn(),
  mayExist: vi.fn(async () => true),
  initializeStorage: vi.fn(),
}));
vi.mock('@app/features/email-thread/preparation-adapter', () => ({
  prepareEmailThreads: mocks.prepare,
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.flag(),
}));
vi.mock('@core/constant/featureFlags', () => ({ enableEmailRenderCache: {} }));
vi.mock('@core/context/user', () => ({ useUserContext: () => mocks.user() }));
vi.mock('@core/auth/logout', () => ({ clearLocalAuthSession: mocks.logout }));
vi.mock('@core/cross-tab/tab-leader', () => ({
  createTabLeaderSignal: () => () => true,
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => false }));
vi.mock('@core/util/platform', () => ({ isTauri: () => false }));
vi.mock('@graphql-cache/lifecycle', () => ({
  registerCacheResetListener: () => () => {},
}));
vi.mock('@graphql-cache/scope', () => ({
  getOrCreateCacheScope: () => 'test-profile',
}));
vi.mock('./executor', () => ({ createPreparationExecutor: () => ({}) }));
vi.mock('./service', () => ({
  EmailRenderCache: class {
    constructor() {
      mocks.caches++;
    }
    dispose = vi.fn();
    initializeStorage = mocks.initializeStorage;
  },
}));
vi.mock('./indexeddb', () => ({
  artifactDatabaseMayExist: mocks.mayExist,
  IndexedDbArtifacts: class {
    async invalidate() {
      mocks.idbInvalidations++;
    }
    close() {}
  },
}));

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

const listening = () =>
  [...Bus.open].filter((channel) => channel.onmessage).length;
const sleep = (ms: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, ms));
/** Lets digests, channel delivery, and clears settle. */
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await sleep(5);
}

type Tab = ReturnType<typeof mountTab>;
const roots: (() => void)[] = [];

function mountTab(options: {
  enabled: boolean;
  loading?: boolean;
  userId?: string;
}) {
  const [authenticated, setAuthenticated] = createSignal<boolean | undefined>(
    true
  );
  const [userId, setUserId] = createSignal<string | undefined>(
    options.userId ?? 'viewer'
  );
  const [flag, setFlag] = createSignal({
    enabled: options.enabled,
    loading: options.loading ?? false,
  });
  mocks.user.mockReturnValueOnce({
    isAuthenticated: authenticated,
    userId,
  });
  mocks.flag.mockReturnValueOnce(flag);
  let current: unknown;
  function Capture() {
    const cache = useEmailRenderCache() as Accessor<unknown>;
    createEffect(() => {
      current = cache();
    });
    return null;
  }
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
    dispose,
    read: () => current,
    setAuthenticated,
    setUserId,
    setFlag,
  };
}

async function mountTabs(count: number, enabled: boolean): Promise<Tab[]> {
  const tabs: Tab[] = [];
  for (let i = 0; i < count; i++) {
    tabs.push(mountTab({ enabled }));
    await vi.waitFor(() => expect(listening()).toBe(i + 1));
  }
  return tabs;
}

/** Another tab that is not modelled as a Solid root posts on the namespace. */
function postFromOtherTab(message: unknown, name = [...Bus.open][0]?.name) {
  if (!name) throw new Error('no session channel');
  const sender = new Bus(name);
  sender.postMessage(message);
  sender.close();
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caches = 0;
  mocks.idbInvalidations = 0;
  mocks.prepare.mockImplementation(() => mocks.release);
  mocks.mayExist.mockImplementation(async () => true);
  Bus.open.clear();
  Bus.posted = [];
  vi.stubGlobal('crypto', webcrypto);
  vi.stubGlobal('BroadcastChannel', Bus);
  // A signed-in device: the login marker is present; clears need IndexedDB.
  vi.stubGlobal('indexedDB', {});
  localStorage.setItem('macro:login', 'true');
});

afterEach(async () => {
  roots.splice(0).forEach((dispose) => dispose());
  await settle(4);
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe('cross-tab session ending', () => {
  it('an unconfirmed UNAUTHORIZED in one tab does not sign another enabled tab out', async () => {
    // Tab A observes a latched refresh failure (fetchWithToken keeps it for
    // 60 s) as a user-info 401, so isAuthenticated() is false. BasePath
    // confirms with a fresh refresh before destroying local session state;
    // here the session refresh succeeds and A recovers.
    const [a, b] = await mountTabs(2, true);
    expect(b.read()).toBeDefined();
    a.setAuthenticated(false);
    await settle();
    a.setAuthenticated(true);
    await settle();
    // Tab B wiped its local session (drafts, composer storage, persisted
    // queries, login cookie) because of A's unconfirmed 401.
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(b.read()).toBeDefined();
  });

  it('an unknown auth state in a flag-off tab never signs flag-on tabs out', async () => {
    const a = mountTab({ enabled: false });
    await vi.waitFor(() => expect(listening()).toBe(1));
    const b = mountTab({ enabled: true });
    await vi.waitFor(() => expect(listening()).toBe(2));
    a.setAuthenticated(undefined); // unknown auth state, not a sign-out
    await settle();
    expect(Bus.posted).not.toContainEqual({
      kind: 'invalidate',
      sessionEnded: true,
    });
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(b.read()).toBeDefined();
  });

  it("signing in as another account (without signing out) never makes the old account's other tabs sign out", async () => {
    // A new tab logs in as "other" (invalidateAllAfterLogin: "Login may
    // replace a session without visiting logout"). Cookies are shared, so
    // tab A1's next user-info fetch returns "other".
    const [a1, a2] = await mountTabs(2, true);
    a1.setUserId('other');
    await settle();
    // A2 now runs clearLocalAuthSession(): deletes the shared login cookie
    // and login marker, rotates the device-wide local-draft epoch, clears
    // persisted queries and the normalized cache that the new account uses.
    expect(mocks.logout).not.toHaveBeenCalled();
    expect(a2.read()).toBeDefined();
  });

  it('the same user signing back in (no reload) after an expired-session logout gets a session again', async () => {
    const tab = mountTab({ enabled: true });
    expect(tab.read()).toBeDefined();
    // user-info 401 with retained data: isAuthenticated false, userId kept.
    tab.setAuthenticated(false);
    expect(tab.read()).toBeUndefined();
    // SessionExpiredRedirect -> clearLocalAuthSession()
    await invalidateEmailRenders('session-ended');
    tab.setUserId(''); // setQueryData(authKeys.userInfo, unauthenticatedUserInfo)
    await settle(2);
    // In-app email-code login: invalidateAllAfterLogin refetches the same id.
    tab.setUserId('viewer');
    tab.setAuthenticated(true);
    await settle(2);
    expect(tab.read()).toBeDefined();
    // Without a session, a later sign-out also neither clears this viewer's
    // namespace nor tells other tabs.
    Bus.posted = [];
    mocks.idbInvalidations = 0;
    await invalidateEmailRenders('session-ended');
    await settle(2);
    expect(Bus.posted).toContainEqual({
      kind: 'invalidate',
      sessionEnded: true,
    });
  });

  it('a tab whose flag was still loading honours a remote sign-out once the flag resolves', async () => {
    const b = mountTab({ enabled: false, loading: true });
    await vi.waitFor(() => expect(listening()).toBe(1));
    postFromOtherTab({ kind: 'invalidate', sessionEnded: true });
    await settle();
    b.setFlag({ enabled: true, loading: false });
    await settle(2);
    // Either local auth is cleared, or at least no cache is served/opened for
    // the identity another tab ended.
    const handled =
      mocks.logout.mock.calls.length > 0 || b.read() === undefined;
    expect(handled).toBe(true);
  });

  it('a sign-out broadcast that lands while a tab rebinds its session still ends caching', async () => {
    const [b] = await mountTabs(1, true);
    const bChannel = [...Bus.open][0];
    // B processes an ordinary invalidation (e.g. its own delete_message), so
    // it closes its channel and creates a successor whose digest is pending.
    bChannel.onmessage?.({
      data: { kind: 'invalidate', sessionEnded: false },
    } as MessageEvent<unknown>);
    // Another tab signs out in that window.
    // The signing-out tab cleared the durable marker before broadcasting.
    localStorage.removeItem('macro:login');
    postFromOtherTab({ kind: 'invalidate', sessionEnded: true }, bChannel.name);
    await settle();
    // The successor connects after the broadcast, sees the device signed out,
    // and stops caching for the ended identity (auth follows the app's 401s).
    expect(b.read()).toBeUndefined();
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});

describe('cross-tab invalidation fan-out', () => {
  for (const tabs of [2, 3, 4, 5]) {
    it(`converges after one websocket delete received by ${tabs} enabled tabs`, async () => {
      await mountTabs(tabs, true);
      const before = { caches: mocks.caches, posts: Bus.posted.length };
      await invalidateEmailRenders();
      await settle(20);
      const created = mocks.caches - before.caches;
      const posts = Bus.posted.length - before.posts;
      console.info(
        `[fan-out] tabs=${tabs} sessionsCreated=${created} broadcasts=${posts} idbInvalidations=${mocks.idbInvalidations}`
      );
      // Converges: no further sessions after the system settles.
      const settled = mocks.caches;
      await settle(20);
      expect(mocks.caches).toBe(settled);
      // Each tab rebinds once; nothing re-broadcasts a received invalidation.
      expect(created).toBe(tabs);
      expect(posts).toBe(tabs);
      expect(listening()).toBe(tabs);
    });
  }

  it('converges for a burst of 20 delete events across 4 tabs (bulk delete)', async () => {
    await mountTabs(4, true);
    const before = mocks.caches;
    for (let i = 0; i < 20; i++) {
      void invalidateEmailRenders();
      await sleep(1);
    }
    await settle(30);
    const created = mocks.caches - before;
    console.info(
      `[burst] tabs=4 events=20 sessionsCreated=${created} idbInvalidations=${mocks.idbInvalidations} broadcasts=${Bus.posted.length}`
    );
    const settled = mocks.caches;
    await settle(20);
    expect(mocks.caches).toBe(settled);
    expect(listening()).toBe(4);
  });

  it('flag-off tabs do the same per-event work (rebind, broadcast, database listing)', async () => {
    mocks.mayExist.mockImplementation(async () => false);
    await mountTabs(3, false);
    const before = mocks.caches;
    await invalidateEmailRenders();
    await settle(20);
    console.info(
      `[flag-off] tabs=3 sessionsCreated=${mocks.caches - before} databaseListings=${mocks.mayExist.mock.calls.length} broadcasts=${Bus.posted.length} idbInvalidations=${mocks.idbInvalidations}`
    );
    expect(mocks.idbInvalidations).toBe(0);
    expect(mocks.initializeStorage).not.toHaveBeenCalled();
  });
});

describe('hydration hints', () => {
  it('releases the previous hydration page on rebind and on flag-off', async () => {
    const { offerEmailPreparationHints } = await import('./hints');
    // jsdom has no Web Locks; the provider only elects a leader when present.
    Object.defineProperty(navigator, 'locks', {
      value: {
        request: (
          _name: string,
          _options: unknown,
          work: () => Promise<unknown>
        ) => work(),
      },
      configurable: true,
    });
    const tab = mountTab({ enabled: true });
    await vi.waitFor(() => expect(listening()).toBe(1));
    offerEmailPreparationHints(['t1']);
    expect(mocks.prepare).toHaveBeenCalledOnce();
    await invalidateEmailRenders();
    expect(mocks.release).toHaveBeenCalledOnce();
    offerEmailPreparationHints(['t2']);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
    tab.setFlag({ enabled: false, loading: false });
    expect(mocks.release).toHaveBeenCalledTimes(2);
    offerEmailPreparationHints(['t3']);
    expect(mocks.prepare).toHaveBeenCalledTimes(2);
  });
});
