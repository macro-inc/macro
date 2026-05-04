import { createEffect, onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isMobile } from '@core/mobile/isMobile';
import { usePermissions } from '@core/context/user';
import { DEV_MODE_ENV, ENABLE_APP_STORE_QR_CODE, ENABLE_TEAMS_OVERRIDE } from '@core/constant/featureFlags';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { Subscription } from './Subscription';
import { MobileApp } from './MobileApp';
import { Appearance } from './Appearance';
import { Tabs } from '@core/component/Tabs';
import { Account } from './Account';
import { Shortcuts } from './Shortcuts';
import { Team } from './Team';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { SplitHeaderLeft, SplitHeaderRight } from '../split-layout/components/SplitHeader';
import { SettingsButton } from './SettingsButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * Wrapper for Settings Panel used in the split layout. Includes the correct Header button.
 */
export function SettingsPanelComponentWrapper() {
  return (
    <>
      <Show when={isMobile()}>
        <SplitHeaderRight>
          <SettingsButton />
        </SplitHeaderRight>
      </Show>
      <SettingsPanel />
    </>
  )
}

type SettingsPanelProps = {
  hide?: boolean;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const { settingsOpen, closeSettings, activeTabId, setActiveTabId } = useSettingsState();
  const permissions = usePermissions();
  const teamsFlag = useFeatureFlag('enable-teams-settings', { enabledOverride: ENABLE_TEAMS_OVERRIDE });

  // Set up hotkey scope for settings panel
  const [attachHotkeys, settingsHotkeyScope] = useHotkeyDOMScope('settings');
  let settingsContainerRef: HTMLDivElement | undefined;

  function focusSettingsOnOpen() {
    if (settingsOpen()){
      setTimeout(() => {
        // Focus the settings container to activate the hotkey scope
        settingsContainerRef?.focus();
      }, 10);
    }
  }

  createEffect(focusSettingsOnOpen);

  function settingsTabs() {
    const tabs: { value: string; label: string }[] = [
      { value: 'Appearance', label: 'Appearance' },
      { value: 'Account', label: 'Account' },
    ];
    if (teamsFlag().enabled) { tabs.push({ value: 'Team', label: 'Team' }) }
    tabs.push({ value: 'Shortcuts', label: 'Shortcuts' });
    if (permissions()?.includes('write:stripe_subscription') && !isNativeMobilePlatform()) { tabs.push({ value: 'Subscription', label: 'Subscription' }) }
    if (ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform()) { tabs.push({ value: 'Mobile App', label: 'App' }) }
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
    if (value === 'Account' || value === 'Subscription' || value === 'Appearance' || value === 'Mobile' || value === 'AI Memory' || value === 'Shortcuts' || value === 'Mobile App' || value === 'Team') {
      setActiveTabId(value as SettingsTab);
    }
  }

  function BottomTabs() {
    return (
    <div class="bg-panel border-t border-edge-muted h-11 shrink-0 px-1">
      <Tabs
        list={settingsTabs()}
        value={activeTabId()}
        defaultValue="Appearance"
        onChange={handleTabChange}
        indicatorPosition="top"
        class="**:data-indicator:h-0.75"
      />
    </div>
    );
  }

  return (
    <div
      class="size-full flex flex-col outline-none bracket-never"
      classList={{ invisible: props.hide }}
      tabIndex={0}
      ref={settingsContainerRef}
    >

      <SplitHeaderLeft>
        <div class="h-full flex gap-3 items-center">
          <h1 class="font-semibold text-ink select-none text-sm shrink-0">
            Settings
          </h1>
          <Show when={!isMobile()}>
            <Tabs
              list={settingsTabs()}
              value={activeTabId()}
              defaultValue="Appearance"
              onChange={handleTabChange}
            />
          </Show>
        </div>
      </SplitHeaderLeft>

      <div class="relative grow min-h-1 overflow-auto">
        <Show when={activeTabId() === 'Account'}>
          <Suspense>
            <Account />
          </Suspense>
        </Show>
        <Show when={activeTabId() === 'Subscription' && permissions()?.includes('write:stripe_subscription') && !isNativeMobilePlatform()}>
          <Subscription />
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
      </div>

      <Show when={isMobile()}>
        <BottomTabs />
      </Show>
    </div>
  );
}
