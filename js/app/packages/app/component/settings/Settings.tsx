import { createEffect, createMemo, For, onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { isMobile } from '@core/mobile/isMobile';
import { DEV_MODE_ENV, ENABLE_APP_STORE_QR_CODE, ENABLE_TEAMS_OVERRIDE } from '@core/constant/featureFlags';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { MobileApp } from './MobileApp';
import { Mcp } from './Mcp';
import { Appearance } from './Appearance';
import { Tabs } from '@core/component/Tabs';
import { Account } from './Account';
import { Shortcuts } from './Shortcuts';
import { Team } from './Team';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { SplitHeaderLeft, SplitHeaderRight } from '../split-layout/components/SplitHeader';
import { CollapsibleHeaderItem } from '../split-layout/components/CollapsibleHeaderItem';
import { SettingsButton } from './SettingsButton';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { DropdownMenu } from '@kobalte/core/dropdown-menu';
import { Layer } from '@ui';
import ChevronDownIcon from '@icon/regular/caret-down.svg';

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
    if (ENABLE_APP_STORE_QR_CODE && !isNativeMobilePlatform()) { tabs.push({ value: 'Mobile App', label: 'App' }) }
    if (!isNativeMobilePlatform()) { tabs.push({ value: 'MCP', label: 'MCP' }) }
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
            <CollapsibleHeaderItem
              id="settings-tabs"
              priority={1}
              containerClass="h-full"
              expanded={() => (
                <Tabs
                  list={settingsTabs()}
                  value={activeTabId()}
                  defaultValue="Appearance"
                  onChange={handleTabChange}
                />
              )}
              collapsed={() => (
                <CollapsedSettingsTabs
                  tabs={settingsTabs()}
                  value={activeTabId()}
                  onChange={handleTabChange}
                />
              )}
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
        <Show when={activeTabId() === 'MCP' && !isNativeMobilePlatform()}>
          <Mcp />
        </Show>
      </div>

      <Show when={isMobile()}>
        <BottomTabs />
      </Show>
    </div>
  );
}

type CollapsedSettingsTabsProps = {
  tabs: { value: string; label: string }[];
  value: string;
  onChange: (value: string) => void;
};

function CollapsedSettingsTabs(props: CollapsedSettingsTabsProps) {
  const activeLabel = createMemo(() => {
    return (
      props.tabs.find((item) => item.value === props.value)?.label ??
      props.tabs[0]?.label
    );
  });

  return (
    <DropdownMenu placement="bottom-start" gutter={4}>
      <DropdownMenu.Trigger class="flex items-center gap-1 px-2 py-1 text-xs font-medium rounded-xs border border-edge-muted hover:bg-ink/6 transition-colors">
        <span class="truncate">{activeLabel()}</span>
        <ChevronDownIcon class="size-3 shrink-0" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <Layer depth={2}>
          <DropdownMenu.Content class="z-action-menu bg-page border border-edge-muted rounded-sm shadow-sm p-1">
            <For each={props.tabs}>
              {(item) => (
                <DropdownMenu.Item
                  class="w-full px-2 py-1.5 text-left text-xs transition-colors hover:bg-ink/5 focus:bg-ink/5 outline-none cursor-default rounded-md"
                  classList={{
                    'font-semibold': props.value === item.value,
                  }}
                  onSelect={() => props.onChange(item.value)}
                >
                  {item.label}
                </DropdownMenu.Item>
              )}
            </For>
          </DropdownMenu.Content>
        </Layer>
      </DropdownMenu.Portal>
    </DropdownMenu>
  );
}
