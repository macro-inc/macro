import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_APP_TAB_ITEM,
  settingsSlugToTab,
  useSettingsTabs,
} from './settingsTabsConfig';

const platform = vi.hoisted(() => ({ current: 'web' }));
const touch = vi.hoisted(() => ({ current: false }));
let flagEnabled: () => boolean;

vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: flagEnabled() }),
}));
vi.mock('../mobile/isTouchDevice', () => ({
  isTouchDevice: () => touch.current,
}));
vi.mock('../context/user', () => ({
  useHasPermission: () => () => false,
  useEmail: () => () => undefined,
  useUserId: () => () => undefined,
}));
vi.mock('../util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../util/platform')>()),
  isPlatform: (target: string) => target === platform.current,
  getPlatform: () => platform.current,
  getNativeMobilePlatform: () =>
    ['ios', 'android'].includes(platform.current)
      ? platform.current
      : undefined,
}));

let dispose: () => void;
afterEach(() => {
  dispose?.();
  platform.current = 'web';
});

describe('Downloads settings', () => {
  // Phones, tablets and the mobile apps have no Downloads page; computers get
  // it in the browser and the desktop app, whatever the remote flags say.
  it.each([
    { host: 'web', onTouch: false, expected: true },
    { host: 'desktop', onTouch: false, expected: true },
    { host: 'web', onTouch: true, expected: false },
    { host: 'ios', onTouch: true, expected: false },
    { host: 'android', onTouch: true, expected: false },
    { host: 'ios', onTouch: false, expected: false },
  ])(
    'is available on $host with touch=$onTouch: $expected',
    ({ host, onTouch, expected }) => {
      platform.current = host;
      touch.current = onTouch;
      const tabs = createRoot((cleanup) => {
        dispose = cleanup;
        flagEnabled = () => false;
        return useSettingsTabs();
      });

      expect(tabs.isAvailable('Downloads')).toBe(expected);
      expect(tabs.flatTabs().some((item) => item.tab === 'Downloads')).toBe(
        expected
      );
      expect(
        tabs
          .searchGroups()
          .some((group) => group.items.some((item) => item.tab === 'Downloads'))
      ).toBe(expected);
      touch.current = false;
    }
  );
});

describe('Native app settings', () => {
  // The installed apps get a page for themselves, named for the platform,
  // last in Personal; the browser has no installed app to describe.
  it.each([
    { host: 'web', onTouch: false, label: undefined },
    { host: 'web', onTouch: true, label: undefined },
    { host: 'desktop', onTouch: false, label: 'Desktop App' },
    { host: 'ios', onTouch: true, label: 'iOS App' },
    { host: 'android', onTouch: true, label: 'Android App' },
  ])('on $host with touch=$onTouch is $label', ({ host, onTouch, label }) => {
    platform.current = host;
    touch.current = onTouch;
    const tabs = createRoot((cleanup) => {
      dispose = cleanup;
      flagEnabled = () => false;
      return useSettingsTabs();
    });

    expect(tabs.isAvailable('Native App')).toBe(label !== undefined);
    const personal = tabs
      .groups()
      .find((group) => group.id === 'personal')
      ?.items.map((item) => item.tab);
    expect(personal?.at(-1) === 'Native App').toBe(label !== undefined);
    if (label) {
      expect(NATIVE_APP_TAB_ITEM.label).toBe(label);
      expect(NATIVE_APP_TAB_ITEM.englishLabel).toBe(label);
    }
    touch.current = false;
  });

  // The old Mobile App and Desktop App pages showed the installed version in
  // the apps and the downloads in a browser.
  it.each([
    { host: 'web', expected: 'Downloads' },
    { host: 'desktop', expected: 'Native App' },
    { host: 'ios', expected: 'Native App' },
    { host: 'android', expected: 'Native App' },
  ])('lands old app page links on $expected on $host', ({ host, expected }) => {
    platform.current = host;
    expect(settingsSlugToTab('mobile-app')).toBe(expected);
    expect(settingsSlugToTab('desktop-app')).toBe(expected);
    expect(settingsSlugToTab('app')).toBe('Native App');
  });
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
    { onTouch: false, expected: false },
    { onTouch: true, expected: true },
  ])('is available on touch=$onTouch: $expected', ({ onTouch, expected }) => {
    touch.current = onTouch;
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
  });
});
