import { For, onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { useSettingsTabs } from '@core/constant/settingsTabsConfig';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isMobile } from '@core/mobile/isMobile';
import { ENABLE_APP_STORE_QR_CODE, ENABLE_TEAMS_OVERRIDE } from '@core/constant/featureFlags';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { MobileApp } from './MobileApp';
import { Agent } from './Agent';
import { Appearance } from './Appearance';
import { TabsInset } from '@core/component/TabsInset';
import { Account } from './Account';
import { Shortcuts } from './Shortcuts';
import { Team } from './Team';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { SideNav } from '@ui';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '../split-layout/components/SplitHeader';
import { SettingsButton } from './SettingsButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';

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

function SettingsPanel(props: SettingsPanelProps) {
  const { closeSettings, activeTabId, setActiveTabId } = useSettingsState();
  const teamsFlag = useFeatureFlag('enable-teams-settings', { enabledOverride: ENABLE_TEAMS_OVERRIDE });
  const { groups, flatTabs } = useSettingsTabs();

  // Set up hotkey scope for settings panel
  const [attachHotkeys, settingsHotkeyScope] = useHotkeyDOMScope('settings');
  let settingsContainerRef: HTMLDivElement | undefined;

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
    const tabs = flatTabs();
    if (index >= 0 && index < tabs.length) {
      const tab = tabs[index];
      if (tab) {
        setActiveTabId(tab.tab);
        return true;
      }
    }
    return false;
  }

  function getCurrentTabIndex() {
    return flatTabs().findIndex(tab => tab.tab === activeTabId());
  }

  function handleNextTab() {
    const tabs = flatTabs();
    const nextIndex = getCurrentTabIndex() >= tabs.length - 1 ? 0 : getCurrentTabIndex() + 1;
    navigateToTabIndex(nextIndex);
    return true;
  }

  function handlePreviousTab() {
    const tabs = flatTabs();
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
    if (flatTabs().some((tab) => tab.tab === value)) {
      setActiveTabId(value as SettingsTab);
    }
  }

  function BottomTabs() {
    return (
    <div class="bg-surface border-t border-edge-muted h-11 shrink-0 px-1 flex items-center">
      <TabsInset
        list={flatTabs().map((tab) => ({ value: tab.tab, label: tab.label }))}
        value={activeTabId()}
        defaultValue="Appearance"
        onChange={handleTabChange}
      />
    </div>
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
        <div class="h-full flex gap-3 items-center">
          <h1 class="font-semibold text-ink select-none text-sm shrink-0">
            Settings
          </h1>
        </div>
      </SplitHeaderLeft>

      <div class="flex grow min-h-1 overflow-hidden">
        <Show when={!isMobile()}>
          <SideNav>
            <For each={groups()}>
              {(group) => (
                <SideNav.Group label={group.label}>
                  <For each={group.items}>
                    {(item) => (
                      <SideNav.Item
                        icon={item.icon}
                        active={activeTabId() === item.tab}
                        onSelect={() => handleTabChange(item.tab)}
                      >
                        {item.label}
                      </SideNav.Item>
                    )}
                  </For>
                </SideNav.Group>
              )}
            </For>
          </SideNav>
        </Show>

        <div class="relative grow min-h-1 min-w-0 overflow-auto">
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
      </div>

      <Show when={isMobile()}>
        <BottomTabs />
      </Show>
    </div>
  );
}
