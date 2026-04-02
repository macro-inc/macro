import { createEffect, createMemo, createSignal, For, onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { SplitlikeContainer } from '../split-layout/components/SplitContainer';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { usePermissions } from '@core/context/user';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import ContractIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import { Subscription } from './Subscription';
import { Appearance } from './Appearance';
import { Tabs } from '@kobalte/core/tabs';
import { Account } from './Account';
import { Shortcuts } from './Shortcuts';
import { isMobile } from '@core/mobile/isMobile';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { SplitHeaderRight } from '../split-layout/components/SplitHeader';
import { SettingsButton } from './SettingsButton';

/**
 * Wrapper specifically for in-Split version of Settings Panel used on Mobile. Includes the correct Header button.
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
  const [spotlight, setSpotlight] = createSignal(false);

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

  /*
  very verbose way to choose which tabs should be shown
  this will be replaced with <Show when={}>
  */
  const settingsTabs = createMemo(() => {
    const tabs: {value: string; label: string }[] = [
      {value: 'Appearance', label: 'Appearance'},
      {value: 'Account', label: 'Account'},
    ];

    if (!isMobile()) {
      tabs.push({value: 'Shortcuts', label: 'Shortcuts'})
    }

    if(permissions()?.includes('write:stripe_subscription') && !isNativeMobilePlatform()){tabs.push({value: 'Subscription', label: 'Subscription'})}
    if(isNativeMobilePlatform() && DEV_MODE_ENV){tabs.push({ value: 'Mobile', label: 'Mobile Dev Tools' })}

    return tabs;
  });

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

  return (
    <div
      class="size-full p-2 pl-0 outline-none bracket-never"
      classList={{
        invisible: props.hide,
      }}
      tabIndex={0}
      ref={settingsContainerRef}
    >
      <SplitlikeContainer
        setSpotlight={setSpotlight}
        spotlight={spotlight}
        tr={!spotlight()}
      >
        <div class="flex flex-col h-full bg-panel border border-edge-muted rounded-sm overflow-hidden isolate">
            <Tabs
              value={activeTabId()}
              onChange={(value: string | undefined) => {
                if(value && (value === 'Account' || value === 'Subscription' || value === 'Appearance' || value === 'Mobile' || value === 'AI Memory' || value === 'Shortcuts')){
                  setActiveTabId(value as SettingsTab);
                }
              }}
              class="flex flex-col h-full"
            >
              {/* Header with tabs */}
              <div class="relative isolate shrink-0 border-b border-edge-muted">
                <div class="flex items-center pl-2 pr-3 gap-2">
                  <Show when={!isMobile()}>
                    <DeprecatedIconButton
                      icon={CloseIcon}
                      onClick={closeSettings}
                      tooltip={{ label: 'Close Settings' }}
                      theme="clear"
                      size="sm"
                    />
                  </Show>

                  <Tabs.List
                    class="flex flex-1 items-center justify-center py-2"
                    as="div"
                  >
                    <div class="border border-edge-muted rounded-xs inline-flex overflow-hidden">
                      <For each={settingsTabs()}>
                        {({ value, label }, i) => {
                          return (
                            <Tabs.Trigger
                              value={value}
                              tabIndex={-1}
                              data-value={value}
                              class="text-xs font-medium relative flex items-center px-2 py-1 border-r border-edge-muted last:border-r-0 transition-colors duration-150 text-ink-muted data-[selected]:text-ink data-[selected]:bg-ink/10 hover:text-ink hover:bg-ink/15 data-[selected]:hover:bg-ink/20"
                            >
                              <span class="flex items-center gap-1.5">
                                <span>{label}</span>
                                <span class="font-mono text-[10px] opacity-50 border border-edge-muted rounded-[3px] px-1 py-px leading-none">{(i() + 1).toString()}</span>
                              </span>
                            </Tabs.Trigger>
                          );
                        }}
                      </For>
                    </div>
                  </Tabs.List>

                  <div class="flex-1" />

                  <Show when={!isMobile()}>
                    <DeprecatedIconButton
                      icon={spotlight() ? ContractIcon : ExpandIcon}
                      onClick={() => setSpotlight(!spotlight())}
                      tooltip={{
                        label: spotlight() ? 'Exit Spotlight' : 'Enter Spotlight Mode'
                      }}
                      theme="clear"
                      size="sm"
                    />
                  </Show>
                </div>
              </div>

              {/* Content area */}
              <div class="flex-1 min-h-0 relative">
                <Tabs.Content value="Account" class="absolute inset-0">
                  <Suspense>
                    <Account />
                  </Suspense>
                </Tabs.Content>
                <Show when={permissions()?.includes('write:stripe_subscription') && !isNativeMobilePlatform()}>
                  <Tabs.Content value="Subscription" class="absolute inset-0">
                    <Subscription />
                  </Tabs.Content>
                </Show>
                <Tabs.Content value="Appearance" class="absolute inset-0">
                  <Appearance />
                </Tabs.Content>
                <Tabs.Content value="Shortcuts" class="absolute inset-0">
                  <Shortcuts />
                </Tabs.Content>
              </div>
            </Tabs>
          </div>
        </SplitlikeContainer>
      </div>
  );
}
