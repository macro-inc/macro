import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  isTauri: vi.fn(() => false),
  isFeatureEnabled: vi.fn<(flag: string) => boolean | undefined>(),
  unsupportedBrowserReason: vi.fn<() => string | undefined>(),
}));

vi.mock('@core/util/platform', () => ({ isTauri: mocks.isTauri }));
vi.mock('./host/browser-support', () => ({
  unsupportedBrowserReason: mocks.unsupportedBrowserReason,
}));
vi.mock('@core/constant/featureFlags', () => ({
  disableBrowserTursoCache: {
    key: 'disable-browser-turso-cache',
    override: undefined,
  },
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
    mocks.isFeatureEnabled.mockReturnValue(undefined);
    mocks.unsupportedBrowserReason.mockReturnValue(undefined);
  });

  it('enables browser cache by default', () => {
    expect(getBrowserTursoCacheRolloutDecision()).toMatchObject({
      enabled: true,
      cohort: 'treatment',
      reason: 'graphql-transport-enabled',
    });
  });

  it('keeps browsers without the cache APIs uncached', () => {
    mocks.unsupportedBrowserReason.mockReturnValue(
      'OPFS is not supported by this browser'
    );
    expect(getBrowserTursoCacheRolloutDecision()).toMatchObject({
      enabled: false,
      reason: 'browser-unsupported',
    });
  });

  it('lets the independent emergency kill win', () => {
    mocks.isFeatureEnabled.mockReturnValue(true);
    expect(getBrowserTursoCacheRolloutDecision()).toMatchObject({
      enabled: false,
      reason: 'emergency-disabled',
    });
  });

  it('does not read browser PostHog flags or subscribe on Tauri', () => {
    mocks.isTauri.mockReturnValue(true);
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
