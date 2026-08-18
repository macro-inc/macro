import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  graphqlEnabled: vi.fn(() => true),
  isFeatureEnabled: vi.fn<(flag: string) => boolean | undefined>(),
}));

vi.mock('@core/util/platform', () => ({ isTauri: mocks.isTauri }));
vi.mock('@core/constant/featureFlags', () => ({
  ENABLE_GRAPHQL_SOUP: mocks.graphqlEnabled,
  ENABLE_BROWSER_TURSO_CACHE_FLAG: 'enable-browser-turso-cache',
  DISABLE_BROWSER_TURSO_CACHE_FLAG: 'disable-browser-turso-cache',
  ENABLE_BROWSER_TURSO_CACHE_OVERRIDE: undefined,
  DISABLE_BROWSER_TURSO_CACHE_OVERRIDE: undefined,
}));
vi.mock('@app/lib/analytics', () => ({
  analytics: {
    posthog: {
      isFeatureEnabled: mocks.isFeatureEnabled,
    },
  },
}));

import { getBrowserTursoCacheRolloutDecision } from './rollout';

describe('browser Turso cache production gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.isTauri.mockReturnValue(false);
    mocks.graphqlEnabled.mockReturnValue(true);
    mocks.isFeatureEnabled.mockReturnValue(undefined);
  });

  it('fails closed while PostHog flags are undefined', () => {
    expect(getBrowserTursoCacheRolloutDecision()).toMatchObject({
      enabled: false,
      cohort: 'control',
      reason: 'not-enabled',
    });
  });

  it('uses a Boolean PostHog rollout and lets the independent kill win', () => {
    mocks.isFeatureEnabled.mockImplementation(
      (flag) => flag === 'enable-browser-turso-cache'
    );
    expect(getBrowserTursoCacheRolloutDecision().enabled).toBe(true);

    mocks.isFeatureEnabled.mockReturnValue(true);
    expect(getBrowserTursoCacheRolloutDecision()).toMatchObject({
      enabled: false,
      reason: 'emergency-disabled',
    });
  });

  it('does not read browser PostHog flags or subscribe on Tauri', () => {
    mocks.isTauri.mockReturnValue(true);
    mocks.graphqlEnabled.mockReturnValue(true);
    mocks.isFeatureEnabled.mockImplementation(() => {
      throw new Error('browser flag touched on Tauri');
    });

    expect(getBrowserTursoCacheRolloutDecision()).toMatchObject({
      enabled: true,
      nativeCacheUnchanged: true,
    });
    expect(mocks.isFeatureEnabled).not.toHaveBeenCalled();
  });

  it('imports without constructing browser workers', async () => {
    const WorkerConstructor = vi.fn(() => {
      throw new Error('worker must stay lazy');
    });
    vi.stubGlobal('Worker', WorkerConstructor);
    vi.stubGlobal('SharedWorker', WorkerConstructor);

    await import('./worker/coordinator-page-adapter');

    expect(WorkerConstructor).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
