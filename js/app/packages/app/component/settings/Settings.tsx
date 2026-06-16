import { onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isMobile } from '@core/mobile/isMobile';
import { DEV_MODE_ENV, ENABLE_APP_STORE_QR_CODE, ENABLE_TEAMS_OVERRIDE } from '@core/constant/featureFlags';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { MobileApp } from './MobileApp';
import { Agent } from './Agent';
import { Appearance } from './Appearance';
import { TabsInset } from '@core/component/TabsInset';
import { TabsInsetDropdown } from '@core/component/TabsInsetDropdown';
import { Account } from './Account';
import { Shortcuts } from './Shortcuts';
import { Team } from './Team';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { FloatRegion } from '../mobile/float-regions/FloatRegion';
import { PillTabs } from '../mobile/PillTabs';
import { HeaderIsland } from '../split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
} from '../split-layout/components/SplitHeader';
import { CollapsibleHeaderItem } from '../split-layout/components/CollapsibleHeaderItem';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

export function SettingsPanelComponentWrapper() {
  return (
      <SettingsPanel />
  )
}

type SettingsPanelProps = {
  hide?: boolean;
};

function SettingsPanel(props: SettingsPanelProps) {
  const { closeSettings, activeTabId, setActiveTabId } = useSettingsState();
    const teamsFlag = useFeatureFlag('enable-teams-settings', { enabledOverride: ENABLE_TEAMS_OVERRIDE });

  // Set up hotkey scope for settings panel
  const [attachHotkeys, settingsHotkeyScope] = useHotkeyDOMScope('settings');
  let settingsContainerRef: HTMLDivElement | undefined;

  function settingsTabs() {
    const tabs: { value: string; label: string }[] = [
      { value: 'Appearance', label: 'Appearance' },
      { value: 'Account', label: 'Account' },
    ];
    if (teamsFlag().enabled) { tabs.push({ value: 'Team', label: 'Team' }) }
    if (!isTouchDevice()) { tabs.push({ value: 'Shortcuts', label: 'Shortcuts' }) }
    if (ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform()) { tabs.push({ value: 'Mobile App', label: 'App' }) }
    if (!isNativeMobilePlatform()) { tabs.push({ value: 'Agent', label: 'MCPs' }) }
    if (isNativeMobilePlatform() && DEV_MODE_ENV) { tabs.push({ value: 'Mobile', label: 'Mobile Dev Tools' }) }
    return tabs;
  }

  // Attach hotkeys to the settings container
  onMount(() => {
    if (settingsContainerRef) {
      attachHotkeys(settingsContainerRef);
    }
  });

  function handleEscapeKey() {
    closeSettings();
    return true;
  }

  // Register Escape key to close settings
  registerHotkey({
    keyDownHandler: handleEscapeKey,
    description: 'Close settings',
    scopeId: settingsHotkeyScope,
    hotkey: 'escape',
  });

  // Helper to navigate to a tab by index
  function navigateToTabIndex(index: number): boolean {
    const tabs = settingsTabs();
    if (index >= 0 && index < tabs.length) {
      const tab = tabs[index];
      if (tab) {
        setActiveTabId(tab.value as SettingsTab);
        return true;
      }
    }
    return false;
  }

  function getCurrentTabIndex() {
    const tabs = settingsTabs();
    return tabs.findIndex(tab => tab.value === activeTabId());
  }

  function handleNextTab() {
    const tabs = settingsTabs();
    const nextIndex = getCurrentTabIndex() >= tabs.length - 1 ? 0 : getCurrentTabIndex() + 1;
    navigateToTabIndex(nextIndex);
    return true;
  }

  function handlePreviousTab() {
    const tabs = settingsTabs();
    const nextIndex = getCurrentTabIndex() <= 0 ? tabs.length - 1 : getCurrentTabIndex() - 1;
    navigateToTabIndex(nextIndex);
    return true;
  }

  // Register Tab key for next tab navigation
  registerHotkey({
    hotkey: 'tab',
    scopeId: settingsHotkeyScope,
    description: 'Next settings tab',
    keyDownHandler: handleNextTab,
    hide: true,
  });

  // Register Shift+Tab for previous tab navigation
  registerHotkey({
    description: 'Previous settings tab',
    keyDownHandler: handlePreviousTab,
    scopeId: settingsHotkeyScope,
    hotkey: 'shift+tab',
    hide: true,
  });

  // Register number keys 1-9 for direct tab navigation
  for (let i = 1; i <= 9; i++) {
    const keyNum = i;
    function handleNumberKey() { return navigateToTabIndex(keyNum - 1); }
    registerHotkey({
      description: `Go to settings tab ${keyNum}`,
      hotkey: `${keyNum}` as ValidHotkey,
      keyDownHandler: handleNumberKey,
      scopeId: settingsHotkeyScope,
      hide: true,
    });
  }

  const handleTabChange = (value: string) => {
    if (settingsTabs().some((tab) => tab.value === value)) {
      setActiveTabId(value as SettingsTab);
    }
  }

  function BottomTabs() {
    return (
      <FloatRegion region="accessory">
        <div class="flex items-center px-(--mobile-chrome-gutter)">
          <PillTabs
            items={settingsTabs()}
            value={activeTabId()}
            onChange={handleTabChange}
          />
        </div>
      </FloatRegion>
    );
  }

  return (
    <div
      class="size-full flex flex-col outline-none"
      classList={{ invisible: props.hide }}
      tabIndex={0}
      data-settings-panel
      ref={settingsContainerRef}
    >
      <SplitHeaderLeft>
        <HeaderIsland>
        <div class="h-full flex gap-3 items-center">
          <h1 class="font-semibold text-ink select-none text-sm shrink-0">
            Settings
          </h1>
          <Show when={!isMobile()}>
            <CollapsibleHeaderItem
              id="settings-tabs"
              priority={1}
              containerClass="h-full"
              expanded={() => (
                <TabsInset
                  list={settingsTabs()}
                  value={activeTabId()}
                  defaultValue="Appearance"
                  onChange={handleTabChange}
                />
              )}
              collapsed={() => (
                <TabsInsetDropdown
                  list={settingsTabs()}
                  value={activeTabId()}
                  defaultValue="Appearance"
                  onChange={handleTabChange}
                />
              )}
            />
          </Show>
          </div>
        </HeaderIsland>
      </SplitHeaderLeft>

      <div class="relative grow min-h-1 overflow-auto mobile:pt-(--mobile-content-inset-top) mobile:pb-(--mobile-content-inset-bottom)">
        <Show when={activeTabId() === 'Account'}>
          <Suspense>
            <Account />
          </Suspense>
        </Show>
        <Show when={activeTabId() === 'Appearance'}>
          <Appearance />
        </Show>
        <Show when={activeTabId() === 'Shortcuts' && !isTouchDevice()}>
          <Shortcuts />
        </Show>
        <Show when={activeTabId() === 'Team' && teamsFlag().enabled}>
          <Suspense>
            <Team />
          </Suspense>
        </Show>
        <Show when={activeTabId() === 'Mobile App' && ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform()}>
          <MobileApp />
        </Show>
        <Show when={activeTabId() === 'Agent' && !isNativeMobilePlatform()}>
          <Agent />
        </Show>
      </div>

      <BottomTabs />
    </div>
  );
}
