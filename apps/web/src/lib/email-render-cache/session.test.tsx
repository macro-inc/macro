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
  constructor() {
    Channel.instances.push(this);
  }
  close() {}
}

function mount(enabled: boolean, loading = false) {
  const [authenticated, setAuthenticated] = createSignal(true);
  const [flag, setFlag] = createSignal({ enabled, loading });
  mocks.user.mockReturnValue({
    isAuthenticated: authenticated,
    userId: () => 'viewer',
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
  return { dispose, read: () => current, setAuthenticated, setFlag };
}

describe('session ownership', () => {
  const roots: (() => void)[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    Channel.instances = [];
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('BroadcastChannel', Channel);
    // jsdom has no IndexedDB; clears only need it to exist (the store is mocked).
    vi.stubGlobal('indexedDB', {});
    localStorage.setItem('macro:login', 'true');
  });
  afterEach(async () => {
    await invalidateEmailRenders('session-ended');
    roots.splice(0).forEach((dispose) => dispose());
    vi.unstubAllGlobals();
    localStorage.clear();
  });

  it('clears cold artifacts and broadcasts logout even when the cache flag is off', async () => {
    const app = mount(false);
    roots.push(app.dispose);
    expect(app.read()).toBeUndefined();
    expect(mocks.initializeStorage).not.toHaveBeenCalled();
    await invalidateEmailRenders('session-ended');
    expect(mocks.invalidate).toHaveBeenCalled();
    expect(mocks.broadcast).toHaveBeenCalledWith({
      kind: 'invalidate',
      sessionEnded: true,
    });
    expect(app.read()).toBeUndefined();
  });

  it('does not rebind after logout overtakes a pending normal reset', async () => {
    const pending = Promise.withResolvers<void>();
    mocks.invalidate.mockImplementationOnce(() => pending.promise);
    const app = mount(true);
    roots.push(app.dispose);
    expect(app.read()).toBeDefined();
    const reset = invalidateEmailRenders();
    const logout = invalidateEmailRenders('session-ended');
    expect(app.read()).toBeUndefined();
    pending.resolve();
    await Promise.all([reset, logout]);
    expect(app.read()).toBeUndefined();
    expect(mocks.broadcast).toHaveBeenCalledWith({
      kind: 'invalidate',
      sessionEnded: true,
    });
  });

  it('still clears old artifacts when the local-storage quarantine is unavailable', async () => {
    const app = mount(false);
    roots.push(app.dispose);
    const storage = vi
      .spyOn(Storage.prototype, 'setItem')
      .mockImplementation(() => {
        throw new Error('Local storage denied');
      });
    try {
      await invalidateEmailRenders('session-ended');
      expect(mocks.invalidate).toHaveBeenCalled();
    } finally {
      storage.mockRestore();
    }
  });

  it('stops caching for an identity another tab signed out, without signing this tab out', async () => {
    const app = mount(true);
    roots.push(app.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    Channel.instances[0].onmessage?.({
      data: { kind: 'invalidate', sessionEnded: true },
    } as MessageEvent);
    expect(app.read()).toBeUndefined();
    expect(mocks.dispose).toHaveBeenCalled();
    // Auth follows the app's own 401 handling, never this broadcast.
    expect(mocks.logout).not.toHaveBeenCalled();
    // A sign-in elsewhere carries no identity, so it never re-enables caching
    // for the identity that ended.
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:login', newValue: 'true' })
    );
    expect(app.read()).toBeUndefined();
  });

  it('ends this viewer when another tab removes the sign-in marker', async () => {
    const app = mount(true);
    roots.push(app.dispose);
    await vi.waitFor(() => expect(app.read()).toBeDefined());
    window.dispatchEvent(
      new StorageEvent('storage', { key: 'macro:login', newValue: null })
    );
    expect(app.read()).toBeUndefined();
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('announces a sign-out confirmed after a 401 already ended the session', async () => {
    const app = mount(true);
    roots.push(app.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    app.setAuthenticated(false);
    await invalidateEmailRenders('session-ended');
    expect(mocks.broadcast).toHaveBeenCalledWith({
      kind: 'invalidate',
      sessionEnded: true,
    });
  });

  it('treats a sign-out it missed as ended when its channel connects', async () => {
    localStorage.removeItem('macro:login');
    const app = mount(true);
    roots.push(app.dispose);
    await vi.waitFor(() => expect(app.read()).toBeUndefined());
    expect(mocks.logout).not.toHaveBeenCalled();
  });

  it('never reports an account switch or unconfirmed 401 as a sign-out', async () => {
    const app = mount(true);
    roots.push(app.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    app.setAuthenticated(false);
    await vi.waitFor(() => expect(mocks.broadcast).toHaveBeenCalled());
    expect(mocks.broadcast).not.toHaveBeenCalledWith({
      kind: 'invalidate',
      sessionEnded: true,
    });
  });
  it('keeps the session and its storage when the flag resolves after mount', async () => {
    const app = mount(false, true);
    roots.push(app.dispose);
    app.setFlag({ enabled: false, loading: false });
    app.setFlag({ enabled: true, loading: false });
    expect(app.read()).toBeDefined();
    expect(mocks.initializeStorage).toHaveBeenCalled();
    app.setFlag({ enabled: false, loading: false });
    expect(app.read()).toBeUndefined();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(mocks.dispose).not.toHaveBeenCalled();
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.broadcast).not.toHaveBeenCalled();
  });

  it('leaves local auth alone when another tab ends the session while disabled', async () => {
    const app = mount(false);
    roots.push(app.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    Channel.instances[0].onmessage?.({
      data: { kind: 'invalidate', sessionEnded: true },
    } as MessageEvent);
    expect(mocks.dispose).toHaveBeenCalled();
    expect(mocks.logout).not.toHaveBeenCalled();
  });
});
