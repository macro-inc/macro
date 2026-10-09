import { webcrypto } from 'node:crypto';
import { createSignal } from 'solid-js';
import { render } from 'solid-js/web';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { invalidateEmailRenders } from './lifecycle';
import { EmailRenderCacheProvider } from './session';
import type { EmailRenderSessionOptions } from './session-runtime';

const mocks = vi.hoisted(() => ({
  sessions: [] as EmailRenderSessionOptions[],
  user: vi.fn(),
  flag: vi.fn(),
}));
vi.mock('@app/features/email-thread/preparation-adapter', () => ({
  prepareEmailThreads: () => () => {},
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => mocks.flag,
}));
vi.mock('@core/constant/featureFlags', () => ({ enableEmailRenderCache: {} }));
vi.mock('@core/context/user', () => ({ useUserContext: () => mocks.user() }));
vi.mock('@core/auth/logout', () => ({ clearLocalAuthSession: vi.fn() }));
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
vi.mock('./session-runtime', () => ({
  createEmailRenderSession(options: EmailRenderSessionOptions) {
    mocks.sessions.push(options);
    return {
      cache: { initializeStorage() {}, dispose() {} },
      invalidate: async () => {},
      dispose: async () => {},
    };
  },
}));

/** Nesting depth of a Promise.allSettled result chain. */
function depth(value: unknown): number {
  let levels = 0;
  let current = value;
  while (Array.isArray(current) && current[0]?.status === 'fulfilled') {
    levels++;
    current = current[0].value;
  }
  return levels;
}

let dispose: () => void;
beforeEach(() => {
  mocks.sessions = [];
  vi.stubGlobal('crypto', webcrypto);
  // A signed-in device: the login marker is present; clears need IndexedDB.
  vi.stubGlobal('indexedDB', {});
  localStorage.setItem('macro:login', 'true');
  const [authenticated] = createSignal(true);
  mocks.user.mockReturnValue({
    isAuthenticated: authenticated,
    userId: () => 'viewer',
  });
  mocks.flag.mockImplementation(() => ({ enabled: true, loading: false }));
  dispose = render(
    () => <EmailRenderCacheProvider>{null}</EmailRenderCacheProvider>,
    document.createElement('div')
  );
});
afterEach(() => {
  dispose();
  vi.unstubAllGlobals();
});

it('the invalidation barrier does not retain settled clears', async () => {
  for (let i = 0; i < 200; i++) await invalidateEmailRenders();
  const latest = mocks.sessions.at(-1)!;
  const settled = await latest.waitForInvalidation();
  // Each invalidation nests the previous barrier's result array inside the
  // next one (listener + disposal), so memory grows linearly with the number
  // of delete_message / link_removed / revocation events in a long-lived tab.
  expect(depth(settled)).toBeLessThan(10);
});
