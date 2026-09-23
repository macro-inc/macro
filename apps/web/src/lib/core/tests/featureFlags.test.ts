import { afterEach, describe, expect, it, vi } from 'vitest';

const remoteFlag = vi.hoisted(() => vi.fn());
vi.mock('@app/lib/analytics', () => ({
  analytics: { posthog: { isFeatureEnabled: remoteFlag } },
}));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  remoteFlag.mockReset();
});

describe('new app views rollout', () => {
  it('allows PostHog to disable and enable the production flag', async () => {
    vi.stubEnv('MODE', 'production');
    vi.stubEnv('VITE_ENABLE_NEW_APP_VIEWS', '');
    vi.resetModules();
    const { enableNewAppViews, isFeatureEnabled } = await import(
      '../constant/featureFlags'
    );
    expect(enableNewAppViews.override).toBeUndefined();
    remoteFlag.mockReturnValue(false);
    expect(isFeatureEnabled(enableNewAppViews)).toBe(false);
    remoteFlag.mockReturnValue(true);
    expect(isFeatureEnabled(enableNewAppViews)).toBe(true);
  });

  it('enables local development by default', async () => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('VITE_ENABLE_NEW_APP_VIEWS', '');
    vi.resetModules();
    const { enableNewAppViews } = await import('../constant/featureFlags');
    expect(enableNewAppViews.override).toBe(true);
  });
});

import { resolveFeatureFlag } from '../constant/featureFlags';

describe('resolveFeatureFlag', () => {
  it('returns the default when no env override is present', () => {
    expect(resolveFeatureFlag('TEST_FLAG_WITHOUT_OVERRIDE', true)).toBe(true);
    expect(resolveFeatureFlag('TEST_FLAG_WITHOUT_OVERRIDE', false)).toBe(false);
  });

  it('enables a flag when the env override is true', () => {
    import.meta.env.VITE_TEST_FLAG_TRUE = 'true';

    expect(resolveFeatureFlag('TEST_FLAG_TRUE', false)).toBe(true);

    delete import.meta.env.VITE_TEST_FLAG_TRUE;
  });

  it('disables a flag when the env override is false', () => {
    import.meta.env.VITE_TEST_FLAG_FALSE = 'false';

    expect(resolveFeatureFlag('TEST_FLAG_FALSE', true)).toBe(false);

    delete import.meta.env.VITE_TEST_FLAG_FALSE;
  });

  it('ignores invalid env values', () => {
    import.meta.env.VITE_TEST_FLAG_INVALID = '1';

    expect(resolveFeatureFlag('TEST_FLAG_INVALID', true)).toBe(true);
    expect(resolveFeatureFlag('TEST_FLAG_INVALID', false)).toBe(false);

    delete import.meta.env.VITE_TEST_FLAG_INVALID;
  });
});
