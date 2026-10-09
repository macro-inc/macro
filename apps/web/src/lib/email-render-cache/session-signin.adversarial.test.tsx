/**
 * Round-2 adversarial checks against the provider's new sign-out handling:
 * a remote sign-out pins the ended identity instead of clearing local auth,
 * and any `macro:login` storage event unpins it.
 */
import { webcrypto } from 'node:crypto';
import { createEffect, createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { invalidateEmailRenders } from './lifecycle';
import { EmailRenderCacheProvider, useEmailRenderCache } from './session';

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  flag: vi.fn(),
  invalidate: vi.fn(async () => {}),
  dispose: vi.fn(),
  initializeStorage: vi.fn(),
  logout: vi.fn(async () => {}),
  broadcast: vi.fn(),
}));
const confirmed = vi.hoisted(() => ({ id: 'viewer', authenticated: true }));
vi.mock('@queries/auth/user-info', () => ({
  fetchUserInfo: async () => ({ ...confirmed }),
}));
vi.mock('@app/features/email-thread/preparation-adapter', () => ({
  prepareEmailThreads: () => () => {},
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.flag,
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
  registerCacheResetListener: () => () => {},
}));
vi.mock('@graphql-cache/scope', () => ({
  getOrCreateCacheScope: () => 'test-profile',
}));
vi.mock('./executor', () => ({ createPreparationExecutor: () => ({}) }));
const viewers: string[] = [];
vi.mock('./service', () => ({
  EmailRenderCache: class {
    dispose = mocks.dispose;
    initializeStorage = mocks.initializeStorage;
  },
}));
vi.mock('./indexeddb', () => ({
  artifactDatabaseMayExist: async () => true,
  IndexedDbArtifacts: class {
    invalidate = mocks.invalidate;
    close() {}
  },
}));

class Channel {
  static instances: Channel[] = [];
  onmessage?: (event: MessageEvent<unknown>) => void;
  postMessage = mocks.broadcast;
  constructor(readonly name: string) {
    Channel.instances.push(this);
  }
  close() {}
}

function mount(userId: string) {
  const [authenticated, setAuthenticated] = createSignal(true);
  const [user, setUser] = createSignal(userId);
  const [flag] = createSignal({ enabled: true, loading: false });
  mocks.user.mockReturnValue({
    isAuthenticated: authenticated,
    userId: () => {
      viewers.push(user());
      return user();
    },
  });
  mocks.flag.mockImplementation(() => flag());
  let current: ReturnType<ReturnType<typeof useEmailRenderCache>>;
  function Capture() {
    const cache = useEmailRenderCache();
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
  return { dispose, read: () => current, setAuthenticated, setUser };
}

describe('remote sign-out pinning', () => {
  const roots: (() => void)[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    Channel.instances = [];
    viewers.length = 0;
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('BroadcastChannel', Channel);
    vi.stubGlobal('indexedDB', {});
    localStorage.setItem('macro:login', 'true');
  });
  afterEach(async () => {
    await invalidateEmailRenders('session-ended');
    roots.splice(0).forEach((dispose) => dispose());
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it("holds since the 18:31 session.tsx change (failed against the reviewed fix set): another account signing in elsewhere no longer revives caching for the signed-out account's stale tab", async () => {
    // Tab A shows `alice`. Alice signs out in tab B (clearing her namespace
    // and broadcasting the session end). Then `bob` signs in in tab B. Tab A
    // has not refetched user-info, so its context still says `alice`, with
    // alice's source data in memory. Before this change tab A cleared local
    // auth on the broadcast (README: "so it cannot repopulate from its
    // previously cached source"); now it only pins `alice`, and the
    // identity-less `macro:login` event from bob's sign-in unpins her.
    const tab = mount('alice');
    roots.push(tab.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    const aliceChannel = Channel.instances[0].name;
    Channel.instances[0].onmessage?.({
      data: { kind: 'invalidate', sessionEnded: true },
    } as MessageEvent);
    expect(tab.read()).toBeUndefined();
    const opened = mocks.initializeStorage.mock.calls.length;

    // Tab B: alice signed out (marker removed), then bob signed in.
    localStorage.removeItem('macro:login');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:login', newValue: null })
    );
    localStorage.setItem('macro:login', 'true');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:login', newValue: 'true' })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));

    // Tab A must not hand out a cache, or open persistent storage, for alice:
    // nothing says alice is signed in again.
    const revived = Channel.instances
      .slice(1)
      .filter((channel) => channel.name === aliceChannel).length;
    expect({
      cacheServed: tab.read() !== undefined,
      storageOpenedAgain: mocks.initializeStorage.mock.calls.length > opened,
      aliceSessionsRecreated: revived,
    }).toEqual({
      cacheServed: false,
      storageOpenedAgain: false,
      aliceSessionsRecreated: 0,
    });
  });

  it('holds since the 18:31 session.tsx change (failed against the reviewed fix set): a device-wide sign-out that sends no session-end broadcast is no longer ignored by other tabs', async () => {
    // Expired session in tab B: user-info 401 flips B's isAuthenticated to
    // false first, so B disposes its session (broadcasting a plain reset,
    // sessionEnded=false). SessionExpiredRedirect then confirms and runs
    // clearLocalAuthSession(): invalidateEmailRenders('session-ended') finds
    // no session in B (resetCurrent is undefined), so no session end is
    // broadcast; only the durable marker is removed. Tab A rebinds on the
    // reset while the marker is still present, so its connect-time check
    // passes, and the provider ignores the marker's removal.
    const tab = mount('viewer');
    roots.push(tab.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    Channel.instances[0].onmessage?.({
      data: { kind: 'invalidate', sessionEnded: false },
    } as MessageEvent);
    await vi.waitFor(() =>
      expect(Channel.instances[1]?.onmessage).toBeDefined()
    );
    expect(tab.read()).toBeDefined();
    // B's clearLocalAuthSession(): marker removed (a storage event here).
    localStorage.removeItem('macro:login');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:login', newValue: null })
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    // The device is signed out; this tab must stop caching (and persisting)
    // for the identity, as it would had it heard a session-end broadcast.
    expect(tab.read()).toBeUndefined();
  });

  it('an idle tab resumes caching once the server confirms the same user signed back in', async () => {
    // The pin is only lifted when this tab's own auth reports signed out.
    // An idle tab makes no request while the device is signed out, so it
    // never sees a 401; after the same user signs back in elsewhere its
    // user-info refetch succeeds with the same identity, which changes no
    // signal. Its email cache stays off until a reload.
    const tab = mount('viewer');
    roots.push(tab.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    localStorage.removeItem('macro:login');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:login', newValue: null })
    );
    expect(tab.read()).toBeUndefined();
    localStorage.setItem('macro:login', 'true');
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:login', newValue: 'true' })
    );
    // The server confirms the same identity signed back in.
    await vi.waitFor(() => expect(tab.read()).toBeDefined());
  });

  it('stays ended when the account that signed in elsewhere is another one', async () => {
    confirmed.id = 'someone-else';
    try {
      const tab = mount('viewer');
      roots.push(tab.dispose);
      await vi.waitFor(() =>
        expect(Channel.instances[0]?.onmessage).toBeDefined()
      );
      localStorage.removeItem('macro:login');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'macro:login', newValue: null })
      );
      localStorage.setItem('macro:login', 'true');
      window.dispatchEvent(
        new StorageEvent('storage', { key: 'macro:login', newValue: 'true' })
      );
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(tab.read()).toBeUndefined();
    } finally {
      confirmed.id = 'viewer';
    }
  });
});
