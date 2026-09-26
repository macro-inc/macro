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
  native: vi.fn(() => false),
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
vi.mock('@core/util/platform', () => ({ isTauri: mocks.native }));
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

function mount(enabled: boolean) {
  const [authenticated, setAuthenticated] = createSignal(true);
  mocks.user.mockReturnValue({
    isAuthenticated: authenticated,
    userId: () => 'viewer',
  });
  mocks.flag.mockReturnValue({ enabled });
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
  return { dispose, read: () => current, setAuthenticated };
}

describe('session ownership', () => {
  const roots: (() => void)[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.native.mockReturnValue(false);
    Channel.instances = [];
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('BroadcastChannel', Channel);
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

  it('does not open an artifact database on native logout', async () => {
    mocks.native.mockReturnValue(true);
    const app = mount(true);
    roots.push(app.dispose);
    await invalidateEmailRenders('session-ended');
    expect(mocks.invalidate).not.toHaveBeenCalled();
    expect(mocks.dispose).toHaveBeenCalled();
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

  it('runs local auth cleanup on another tab ending the viewer session', async () => {
    const app = mount(true);
    roots.push(app.dispose);
    await vi.waitFor(() =>
      expect(Channel.instances[0]?.onmessage).toBeDefined()
    );
    Channel.instances[0].onmessage?.({
      data: { kind: 'invalidate', sessionEnded: true },
    } as MessageEvent);
    expect(app.read()).toBeUndefined();
    expect(mocks.logout).toHaveBeenCalledOnce();
    expect(mocks.dispose).toHaveBeenCalled();
  });
});
