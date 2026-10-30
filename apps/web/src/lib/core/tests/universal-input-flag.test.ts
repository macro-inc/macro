import { afterEach, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@app/lib/analytics', () => ({ analytics: { posthog } }));

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
  vi.clearAllMocks();
});

it.each([
  { mode: 'development', dev: false },
  { mode: 'local', dev: true },
  { mode: 'production', dev: true },
])('enables Universal Input for $mode with DEV=$dev', async ({ mode, dev }) => {
  vi.stubEnv('MODE', mode);
  vi.stubEnv('DEV', dev);
  vi.stubEnv('VITE_ENABLE_UNIVERSAL_INPUT', undefined);
  const { enableUniversalInput, isFeatureEnabled } = await import(
    '../constant/featureFlags'
  );
  expect(enableUniversalInput.override).toBe(true);
  expect(isFeatureEnabled(enableUniversalInput)).toBe(true);
  expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
});

it('defers production Universal Input availability to PostHog', async () => {
  vi.stubEnv('MODE', 'production');
  vi.stubEnv('DEV', false);
  vi.stubEnv('VITE_ENABLE_UNIVERSAL_INPUT', undefined);
  const { enableUniversalInput, isFeatureEnabled } = await import(
    '../constant/featureFlags'
  );
  expect(enableUniversalInput.override).toBeUndefined();
  for (const enabled of [undefined, false, true]) {
    posthog.isFeatureEnabled.mockReturnValue(enabled);
    expect(isFeatureEnabled(enableUniversalInput)).toBe(enabled ?? false);
  }
  expect(posthog.isFeatureEnabled).toHaveBeenLastCalledWith(
    'enable-universal-input'
  );
});

it.each([false, true])('honors the explicit override %s', async (enabled) => {
  vi.stubEnv('MODE', 'development');
  vi.stubEnv('DEV', true);
  vi.stubEnv('VITE_ENABLE_UNIVERSAL_INPUT', String(enabled));
  const { enableUniversalInput, isFeatureEnabled } = await import(
    '../constant/featureFlags'
  );
  expect(isFeatureEnabled(enableUniversalInput)).toBe(enabled);
  expect(posthog.isFeatureEnabled).not.toHaveBeenCalled();
});
