import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DownloadsButton } from './footer-actions';

const mocks = vi.hoisted(() => ({
  platform: 'web',
  touch: false,
  openSettings: vi.fn(),
}));

vi.mock('@app/lib/analytics/analytics-context', () => ({
  useAnalytics: () => ({ track: vi.fn() }),
}));
vi.mock('@app/lib/analytics/posthog', () => ({
  useFeatureFlag: () => () => ({ enabled: false }),
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@core/constant/SettingsState', () => ({
  useSettingsState: () => ({
    openSettings: mocks.openSettings,
    openSettingsInSplit: vi.fn(),
    activeTabId: () => undefined,
  }),
}));
vi.mock('@core/context/user', () => ({
  useHasPermission: () => () => false,
  useEmail: () => () => undefined,
  useUserId: () => () => undefined,
}));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.touch,
}));
vi.mock('@core/util/platform', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@core/util/platform')>()),
  isPlatform: (target: string) => target === mocks.platform,
  getPlatform: () => mocks.platform,
  isDesktopPlatform: () => mocks.platform === 'desktop',
  getNativeMobilePlatform: () =>
    ['ios', 'android'].includes(mocks.platform) ? mocks.platform : undefined,
}));

afterEach(() => {
  cleanup();
  mocks.platform = 'web';
  mocks.touch = false;
  vi.clearAllMocks();
});

describe('rail Downloads button', () => {
  // A browser offers the desktop installers from the rail; the installed
  // desktop app keeps the page in Settings only, and touch has no page.
  it.each([
    { host: 'web', onTouch: false, shown: true },
    { host: 'desktop', onTouch: false, shown: false },
    { host: 'web', onTouch: true, shown: false },
  ])(
    'on $host with touch=$onTouch is shown: $shown',
    ({ host, onTouch, shown }) => {
      mocks.platform = host;
      mocks.touch = onTouch;
      render(() => <DownloadsButton />);

      const button = screen.queryByRole('button', { name: 'Downloads' });
      expect(button !== null).toBe(shown);
    }
  );

  it('opens the Downloads settings page in a browser', () => {
    render(() => <DownloadsButton />);
    fireEvent.click(screen.getByRole('button', { name: 'Downloads' }));
    expect(mocks.openSettings).toHaveBeenCalledExactlyOnceWith('Downloads');
  });
});
