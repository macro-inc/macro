import { afterEach, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@app/lib/analytics', () => ({ analytics: { posthog } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

it('defaults production Projects to off while allowing PostHog rollout', async () => {
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_ENABLE_PROJECTS', undefined);
  const { enableProjects, isFeatureEnabled } = await import(
    '../constant/featureFlags'
  );
  expect(enableProjects).toEqual({
    key: 'enable-projects',
    override: undefined,
  });
  posthog.isFeatureEnabled.mockReturnValue(undefined);
  expect(isFeatureEnabled(enableProjects)).toBe(false);
  posthog.isFeatureEnabled.mockReturnValue(true);
  expect(isFeatureEnabled(enableProjects)).toBe(true);
  posthog.isFeatureEnabled.mockReturnValue(false);
  expect(isFeatureEnabled(enableProjects)).toBe(false);
  expect(posthog.isFeatureEnabled).toHaveBeenLastCalledWith('enable-projects');
});

it.each([false, true])(
  'honors an explicit local override of %s',
  async (enabled) => {
    vi.stubEnv('MODE', 'development');
    vi.stubEnv('DEV', true);
    vi.stubEnv('VITE_ENABLE_PROJECTS', String(enabled));
    const { enableProjects, isFeatureEnabled } = await import(
      '../constant/featureFlags'
    );
    expect(enableProjects.override).toBe(enabled);
    expect(isFeatureEnabled(enableProjects)).toBe(enabled);
    expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
  }
);

it('enables Projects by default in development', async () => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_ENABLE_PROJECTS', undefined);
  const { enableProjects, isFeatureEnabled } = await import(
    '../constant/featureFlags'
  );
  expect(enableProjects.override).toBe(true);
  expect(isFeatureEnabled(enableProjects)).toBe(true);
  expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
});
