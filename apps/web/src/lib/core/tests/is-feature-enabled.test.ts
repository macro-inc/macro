import { createMemo, createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';

const posthog = vi.hoisted(() => ({ isFeatureEnabled: vi.fn() }));
vi.mock('@app/lib/analytics', () => ({ analytics: { posthog } }));

afterEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  localStorage.clear();
});

async function load() {
  const [{ isFeatureEnabled }, { flagStore }] = await Promise.all([
    import('../constant/featureFlags'),
    import('@app/lib/analytics/flag-store'),
  ]);
  const flag = { key: 'enable-crm', override: undefined };
  const read = createRoot(() => createMemo(() => isFeatureEnabled(flag)));
  return { flagStore, read };
}

it('updates a reactive reader when PostHog answers late', async () => {
  const { flagStore, read } = await load();
  posthog.isFeatureEnabled.mockReturnValue(undefined);
  flagStore.receiveRemote(true);
  expect(read()).toBe(false);

  posthog.isFeatureEnabled.mockReturnValue(true);
  flagStore.receiveRemote(false);
  expect(read()).toBe(true);
});

it("reads the backend's flags when PostHog fails", async () => {
  const { flagStore, read } = await load();
  posthog.isFeatureEnabled.mockReturnValue(undefined);
  flagStore.setAccount({
    userId: 'macro|flags@example.com',
    fetchFlags: async () => ({ 'enable-crm': true }),
  });
  flagStore.receiveRemote(true);
  await new Promise((resolve) => setTimeout(resolve));

  expect(read()).toBe(true);
});
