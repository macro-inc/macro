import {
  MobileSettingsProvider,
  useMobileSettings,
} from '@app/features/settings/context/mobile-settings';
import {
  setActiveTabId as setSplitActiveTabId,
  activeTabId as splitActiveTabId,
} from '@core/signal/settingsTab';
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useSettingsState } from './SettingsState';

const mocks = vi.hoisted(() => ({
  mobile: true,
  hasSettingsSplit: false,
  removeSplit: vi.fn(),
  openWithSplit: vi.fn(),
  replaceAllSplits: vi.fn(),
  navigate: vi.fn(),
}));
vi.mock('@core/mobile/isMobile', () => ({ isMobile: () => mocks.mobile }));
vi.mock('@core/mobile/isTouchDevice', () => ({
  isTouchDevice: () => mocks.mobile,
}));
vi.mock('@app/signal/splitLayout', () => ({
  globalSplitManager: () => ({
    splits: () =>
      mocks.hasSettingsSplit
        ? [
            {
              id: 'settings-split',
              content: { type: 'component', id: 'settings' },
            },
          ]
        : [],
    removeSplit: mocks.removeSplit,
  }),
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
  let mobile!: ReturnType<typeof useMobileSettings>;
  function Probe() {
    state = useSettingsState();
    mobile = useMobileSettings();
    return (
      <output aria-label="Active settings page">
        {state.activeTabId() ?? 'index'}
      </output>
    );
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
  mocks.hasSettingsSplit = false;
  setSplitActiveTabId('Account');
});
afterEach(cleanup);

describe('settings entry points', () => {
  it.each([true, false])(
    'requires the provider when mobile is %s',
    (mobile) => {
      mocks.mobile = mobile;
      function MissingProvider() {
        useSettingsState();
        return null;
      }
      expect(() => render(() => <MissingProvider />)).toThrow(
        'useMobileSettings requires MobileSettingsProvider'
      );
    }
  );

  it('opens the mobile index without replacing the page or changing its URL', () => {
    const { state, mobile } = mountSettings();
    state.toggleSettings();
    expect(state.settingsOpen()).toBe(true);
    expect(mobile.page()).toBeUndefined();
    expect(state.activeTabId()).toBeUndefined();
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

  it('reads the same mobile page that entry points and sheet navigation select', () => {
    const { state, mobile } = mountSettings();
    const page = screen.getByLabelText('Active settings page');
    state.openSettings('Billing');
    expect(state.activeTabId()).toBe('Billing');
    expect(page.textContent).toBe('Billing');
    state.selectTab('Appearance');
    expect(state.activeTabId()).toBe('Appearance');
    expect(page.textContent).toBe('Appearance');
    mobile.selectPage('Connected');
    expect(state.activeTabId()).toBe('Connected');
    expect(page.textContent).toBe('Connected');
    mobile.selectPage();
    expect(state.activeTabId()).toBeUndefined();
    expect(page.textContent).toBe('index');
    expect(splitActiveTabId()).toBe('Account');
  });

  it('keeps selection in mobile state even when the sheet is closed', () => {
    const { state, mobile } = mountSettings();
    state.selectTab('Billing');
    expect(state.activeTabId()).toBe('Billing');
    expect(mobile.page()).toBe('Billing');
    expect(state.settingsOpen()).toBe(false);
    expect(splitActiveTabId()).toBe('Account');
    state.openSettings();
    expect(state.activeTabId()).toBeUndefined();
  });

  it('ignores a settings split when reading or closing the mobile sheet', () => {
    mocks.hasSettingsSplit = true;
    const { state } = mountSettings();
    expect(state.settingsOpen()).toBe(false);
    state.closeSettings();
    state.openSettings('Billing');
    expect(state.settingsOpen()).toBe(true);
    state.closeSettings();
    expect(state.settingsOpen()).toBe(false);
    expect(mocks.removeSplit).not.toHaveBeenCalled();
  });

  it('ignores retained mobile state when using desktop settings', () => {
    mocks.mobile = false;
    const { state, mobile } = mountSettings();
    mobile.openSettings('Billing');
    expect(state.settingsOpen()).toBe(false);
    expect(state.activeTabId()).toBe('Account');
    state.selectTab('Appearance');
    expect(state.activeTabId()).toBe('Appearance');
    expect(splitActiveTabId()).toBe('Appearance');
    expect(mobile.page()).toBe('Billing');
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
