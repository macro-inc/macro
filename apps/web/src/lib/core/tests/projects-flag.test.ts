import { afterEach, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@app/lib/analytics', () => ({ analytics: { posthog } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

it('defaults deployed Projects to off while allowing PostHog rollout', async () => {
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

it('resolves off immediately in dev where the analytics SDK is disabled', async () => {
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_ENABLE_PROJECTS', undefined);
  const { enableProjects, isFeatureEnabled } = await import(
    '../constant/featureFlags'
  );
  expect(enableProjects.override).toBe(false);
  expect(isFeatureEnabled(enableProjects)).toBe(false);
  expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
});
