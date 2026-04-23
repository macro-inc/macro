import { createEffect, onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { usePermissions } from '@core/context/user';
import { DEV_MODE_ENV, ENABLE_APP_STORE_QR_CODE } from '@core/constant/featureFlags';
import { Subscription } from './Subscription';
import { MobileApp } from './MobileApp';
import { Appearance } from './Appearance';
import { Tabs } from '@core/component/Tabs';
import { Account } from './Account';
import { Shortcuts } from './Shortcuts';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { SplitHeaderLeft, SplitHeaderRight } from '../split-layout/components/SplitHeader';
import { SettingsButton } from './SettingsButton';

/**
 * Wrapper for Settings Panel used in the split layout. Includes the correct Header button.
 */
export function SettingsPanelComponentWrapper() {
  return (
    <>
      <SplitHeaderRight>
        <SettingsButton />
      </SplitHeaderRight>
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

  // Set up hotkey scope for settings panel
  const [attachHotkeys, settingsHotkeyScope] = useHotkeyDOMScope('settings');
  let settingsContainerRef: HTMLDivElement | undefined;

  createEffect(() => {
    if (settingsOpen()){
      setTimeout(() => {
        // Focus the settings container to activate the hotkey scope
        settingsContainerRef?.focus();
      }, 10);
    }
  });

  const settingsTabs = () => {
    const tabs: { value: string; label: string }[] = [
      { value: 'Appearance', label: 'Appearance' },
      { value: 'Account', label: 'Account' },
    ];

    tabs.push({ value: 'Shortcuts', label: 'Shortcuts' });
    if (permissions()?.includes('write:stripe_subscription') && !isNativeMobilePlatform()) { tabs.push({ value: 'Subscription', label: 'Subscription' }) }
    if (ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform()) { tabs.push({ value: 'Mobile App', label: 'App' }) }
    if (isNativeMobilePlatform() && DEV_MODE_ENV) { tabs.push({ value: 'Mobile', label: 'Mobile Dev Tools' }) }
    return tabs;
  };

  // Attach hotkeys to the settings container
  onMount(() => {
    if (settingsContainerRef) {
      attachHotkeys(settingsContainerRef);
    }
  });

  // Register Escape key to close settings
  registerHotkey({
    hotkey: 'escape',
    scopeId: settingsHotkeyScope,
    description: 'Close settings',
    keyDownHandler: () => {
      closeSettings();
      return true;
    },
  });

  // Helper to navigate to a tab by index
  const navigateToTabIndex = (index: number): boolean => {
    const tabs = settingsTabs();
    if (index >= 0 && index < tabs.length) {
      const tab = tabs[index];
      if (tab) {
        setActiveTabId(tab.value as SettingsTab);
        return true;
      }
    }
    return false;
  };

  const getCurrentTabIndex = () => {
    const tabs = settingsTabs();
    return tabs.findIndex(tab => tab.value === activeTabId());
  };

  // Register Tab key for next tab navigation
  registerHotkey({
    hotkey: 'tab',
    scopeId: settingsHotkeyScope,
    description: 'Next settings tab',
    keyDownHandler: () => {
      const tabs = settingsTabs();
      const nextIndex = getCurrentTabIndex() >= tabs.length - 1 ? 0 : getCurrentTabIndex() + 1;
      navigateToTabIndex(nextIndex);
      return true;
    },
    hide: true,
  });

  // Register Shift+Tab for previous tab navigation
  registerHotkey({
    hotkey: 'shift+tab',
    scopeId: settingsHotkeyScope,
    description: 'Previous settings tab',
    keyDownHandler: () => {
      const tabs = settingsTabs();
      const nextIndex = getCurrentTabIndex() <= 0 ? tabs.length - 1 : getCurrentTabIndex() - 1;
      navigateToTabIndex(nextIndex);
      return true;
    },
    hide: true,
  });

  // Register number keys 1-9 for direct tab navigation
  for (let i = 1; i <= 9; i++) {
    const keyNum = i;
    registerHotkey({
      hotkey: `${keyNum}` as ValidHotkey,
      scopeId: settingsHotkeyScope,
      description: `Go to settings tab ${keyNum}`,
      keyDownHandler: () => navigateToTabIndex(keyNum - 1),
      hide: true,
    });
  }

  const handleTabChange = (value: string) => {
    if (value === 'Account' || value === 'Subscription' || value === 'Appearance' || value === 'Mobile' || value === 'AI Memory' || value === 'Shortcuts' || value === 'Mobile App') {
      setActiveTabId(value as SettingsTab);
    }
  };

  const BottomTabs = () => (
    <div class="bg-panel border-t border-edge-muted h-11 px-1">
      <Tabs
        list={settingsTabs()}
        value={activeTabId()}
        defaultValue="Appearance"
        onChange={handleTabChange}
        indicatorPosition="top"
        class="[&_[data-indicator]]:h-[3px]"
      />
    </div>
  );

  return (
    <div
      class="size-full flex flex-col outline-none bracket-never"
      classList={{
        invisible: props.hide,
      }}
      tabIndex={0}
      ref={settingsContainerRef}
    >
      {/* Header */}
      <SplitHeaderLeft>
        <div class="h-full flex gap-3 items-center">
          <h1 class="font-semibold text-ink select-none text-sm shrink-0">
            Settings
          </h1>
        </div>
      </SplitHeaderLeft>

      {/* Content area */}
      <div class="relative flex-grow min-h-1 overflow-auto">
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
        <Show when={activeTabId() === 'Shortcuts'}>
          <Shortcuts />
        </Show>
        <Show when={activeTabId() === 'Mobile App' && ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform()}>
          <MobileApp />
        </Show>
      </div>
      {/* Bottom tabs */}
      <BottomTabs />
    </div>
  );
}
