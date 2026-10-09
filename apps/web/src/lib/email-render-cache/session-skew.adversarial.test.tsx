import { webcrypto } from 'node:crypto';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';

/**
 * Each "tab" loads its own module graph (vi.resetModules), so lifecycle
 * listeners are per tab like in separate browser tabs. A websocket event then
 * reaches tabs one after another (realistic arrival skew), instead of all
 * tabs at once through one shared listener set.
 */

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  flag: vi.fn(),
  caches: 0,
  idbInvalidations: 0,
  logout: vi.fn(async () => {}),
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
    dispose() {}
    initializeStorage() {}
  },
}));
vi.mock('./indexeddb', () => ({
  artifactDatabaseMayExist: async () => true,
  IndexedDbArtifacts: class {
    async invalidate() {
      mocks.idbInvalidations++;
    }
    close() {}
  },
}));

class Bus {
  static open = new Set<Bus>();
  static posted = 0;
  onmessage?: (event: MessageEvent<unknown>) => void;
  closed = false;
  constructor(readonly name: string) {
    Bus.open.add(this);
  }
  postMessage(data: unknown) {
    Bus.posted++;
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
async function settle(rounds = 10) {
  for (let i = 0; i < rounds; i++) await sleep(5);
}

const roots: (() => void)[] = [];

async function openTab(enabled: boolean) {
  vi.resetModules();
  const solid = await import('solid-js');
  const web = await import('solid-js/web');
  const session = await import('./session');
  const lifecycle = await import('./lifecycle');
  const [authenticated] = solid.createSignal(true);
  const [flag] = solid.createSignal({ enabled, loading: false });
  mocks.user.mockReturnValueOnce({
    isAuthenticated: authenticated,
    userId: () => 'viewer',
  });
  mocks.flag.mockReturnValueOnce(flag);
  roots.push(
    web.render(
      () =>
        solid.createComponent(session.EmailRenderCacheProvider, {
          children: null,
        }),
      document.createElement('div')
    )
  );
  return lifecycle;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.caches = 0;
  mocks.idbInvalidations = 0;
  Bus.open.clear();
  Bus.posted = 0;
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

for (const count of [2, 3, 4, 5]) {
  it(`one websocket delete with arrival skew across ${count} tabs stays linear`, async () => {
    const tabs = [];
    for (let i = 0; i < count; i++) {
      tabs.push(await openTab(true));
      await vi.waitFor(() => expect(listening()).toBe(i + 1));
    }
    const before = mocks.caches;
    // The same server event reaches each tab's websocket a little later.
    for (const tab of tabs) {
      // Each tab's socket receives the event; sync.ts invalidates locally.
      await tab.invalidateEmailRenders('local');
      await settle();
    }
    await settle(20);
    const rebinds = mocks.caches - before;
    console.info(
      `[skew] tabs=${count} sessionRebinds=${rebinds} broadcasts=${Bus.posted} idbInvalidations=${mocks.idbInvalidations}`
    );
    // Converges...
    const settled = mocks.caches;
    await settle(20);
    expect(mocks.caches).toBe(settled);
    expect(listening()).toBe(count);
    // ...but each tab's own invalidation is re-delivered to every other tab,
    // which already handled the same event: quadratic rebinds per event.
    expect(rebinds).toBeLessThanOrEqual(2 * count);
  });
}
