import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useSettingsTabs } from './settingsTabsConfig';

const platform = vi.hoisted(() => ({ current: 'web' }));
const touch = vi.hoisted(() => ({ current: false }));
let flagEnabled: () => boolean;
let agentsEnabled: () => boolean = () => false;

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: (flag: { key: string }) => () => ({
    enabled:
      (flag.key === 'desktop-app' && flagEnabled()) ||
      (flag.key === 'enable-chat-v3-agents' && agentsEnabled()),
  }),
}));
vi.mock('../mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.current,
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

describe('Notifications settings', () => {
  // The page used to sit behind a remote flag, so the desktop app and the
  // browser could disagree on where the notification switch lived.
  it.each(['web', 'desktop', 'ios', 'android'])(
    'is a standing Personal tab on %s with every remote flag off',
    (host) => {
      platform.current = host;
      const tabs = createRoot((cleanup) => {
        dispose = cleanup;
        flagEnabled = () => false;
        return useSettingsTabs();
      });

      expect(tabs.isAvailable('Notifications')).toBe(true);
      const personal = tabs
        .groups()
        .find((group) => group.label === 'Personal');
      expect(personal?.items.map((item) => item.tab)).toContain(
        'Notifications'
      );
    }
  );
});

describe('Routines settings', () => {
  // Desktop lists Routines in the Agents sidebar, which touch hides.
  it.each([
    { onTouch: false, agents: true, expected: false },
    { onTouch: true, agents: false, expected: false },
    { onTouch: true, agents: true, expected: true },
  ])(
    'is available on touch=$onTouch with agents=$agents: $expected',
    ({ onTouch, agents, expected }) => {
      touch.current = onTouch;
      agentsEnabled = () => agents;
      const tabs = createRoot((cleanup) => {
        dispose = cleanup;
        flagEnabled = () => false;
        return useSettingsTabs();
      });

      expect(tabs.isAvailable('Routines')).toBe(expected);
      const blocks = tabs.groups().find((group) => group.label === 'Blocks');
      expect(blocks?.items.map((item) => item.tab).includes('Routines')).toBe(
        expected
      );
      touch.current = false;
      agentsEnabled = () => false;
    }
  );
});
