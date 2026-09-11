import {
  MobileSettingsProvider,
  useMobileSettings,
} from '@app/features/settings/context/mobile-settings';
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsState } from './SettingsState';

const mocks = vi.hoisted(() => ({
  mobile: true,
  openWithSplit: vi.fn(),
  replaceAllSplits: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobile,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => undefined,
}));
vi.mock('@components/app/split-layout/layout', () => ({
  useSplitLayout: () => mocks,
}));
vi.mock('@solidjs/router', () => ({
  useNavigate: () => mocks.navigate,
  useLocation: () => ({
    pathname: '/app/component/inbox',
    search: '?keep=1',
    hash: '#position',
  }),
}));
vi.mock('./settingsSplitUrl', () => ({
  stripSettingsSplitFromUrl: (url: string) => url,
  appendSettingsSplitToUrl: (url: string) => url,
}));
vi.mock('./settingsTabsConfig', () => ({
  settingsTabToSlug: (tab: string) => tab.toLowerCase(),
  settingsSlugToTab: () => undefined,
}));

function mountSettings() {
  let state!: ReturnType<typeof useSettingsState>;
  let mobile!: NonNullable<ReturnType<typeof useMobileSettings>>;
  function Probe() {
    state = useSettingsState();
    mobile = useMobileSettings()!;
    return null;
  }
  render(() => (
    <MobileSettingsProvider>
      <Probe />
    </MobileSettingsProvider>
  ));
  return { state, mobile };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.mobile = true;
});
afterEach(cleanup);

describe('settings entry points', () => {
  it('opens the mobile index without replacing the page or changing its URL', () => {
    const { state, mobile } = mountSettings();
    state.toggleSettings();
    expect(state.settingsOpen()).toBe(true);
    expect(mobile.page()).toBeUndefined();
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
    expect(mocks.replaceAllSplits).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
  });

  it('opens requested sections, supports back, and resets the next session to the index', () => {
    const { state, mobile } = mountSettings();
    state.openSettings('Billing');
    expect(mobile.page()).toBe('Billing');
    state.selectTab('Appearance');
    expect(mobile.page()).toBe('Appearance');
    mobile.selectPage();
    expect(mobile.page()).toBeUndefined();
    expect(state.settingsOpen()).toBe(true);
    state.closeSettings();
    expect(state.settingsOpen()).toBe(false);
    state.openSettingsInSplit('Connected');
    expect(mobile.page()).toBe('Connected');
    state.toggleSettings();
    state.toggleSettings();
    expect(mobile.page()).toBeUndefined();
    expect(state.settingsOpen()).toBe(true);
    expect(mocks.openWithSplit).not.toHaveBeenCalled();
  });

  it('keeps desktop fullscreen and explicit split entry points', () => {
    mocks.mobile = false;
    const { state, mobile } = mountSettings();
    state.openSettings('Billing');
    expect(mobile.open()).toBe(false);
    expect(state.activeTabId()).toBe('Billing');
    expect(mocks.replaceAllSplits).toHaveBeenCalledWith({
      type: 'component',
      id: 'settings',
    });
    state.openSettingsInSplit('Appearance');
    expect(mocks.openWithSplit).toHaveBeenCalledWith(
      { type: 'component', id: 'settings' },
      expect.objectContaining({ allowDuplicate: false, preferNewSplit: true })
    );
  });
});
