import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsTabs } from './settingsTabsConfig';

const platform = vi.hoisted(() => ({ current: 'web' }));
let flagEnabled: () => boolean;

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled: flag.key === 'desktop-app' && flagEnabled(),
  }),
}));
vi.mock('../context/user', () => ({ useHasPermission: () => () => false }));
vi.mock('../util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../util/platform')>()),
  isPlatform: (target: string) => target === platform.current,
  getNativeMobilePlatform: () =>
    ['ios', 'android'].includes(platform.current)
      ? platform.current
      : undefined,
}));

let dispose: () => void;
afterEach(() => dispose?.());

describe('Desktop App settings rollout', () => {
  it.each(['web', 'desktop', 'ios', 'android'])(
    'gates navigation, search, and direct access on %s',
    (host) => {
      platform.current = host;
      const tabs = createRoot((cleanup) => {
        dispose = cleanup;
        const [enabled, setEnabled] = createSignal(false);
        flagEnabled = enabled;
        return { ...useSettingsTabs(), setEnabled };
      });

      for (const enabled of [false, true, false]) {
        tabs.setEnabled(enabled);
        const expected = host === 'desktop' || (host === 'web' && enabled);
        expect(tabs.isAvailable('Desktop App')).toBe(expected);
        expect(tabs.flatTabs().some((item) => item.tab === 'Desktop App')).toBe(
          expected
        );
        expect(
          tabs
            .searchGroups()
            .some((group) =>
              group.items.some((item) => item.tab === 'Desktop App')
            )
        ).toBe(expected);
      }
    }
  );
});
