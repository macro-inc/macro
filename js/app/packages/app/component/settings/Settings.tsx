import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { SplitlikeContainer } from '../split-layout/components/SplitContainer';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { usePermissions } from '@core/context/user';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import ContractIcon from '@icon/regular/arrows-in.svg';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import { withAnalytics } from '@coparse/analytics';
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

const SCROLL_THRESHOLD = 10;

const { track, TrackingEvents } = withAnalytics();

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

  let scrollRef!: HTMLDivElement;
  let scrollCleanup: (() => void) | undefined;
  const [leftOpacity, setLeftOpacity] = createSignal(0);
  const [rightOpacity, setRightOpacity] = createSignal(0);
  const [indicatorStyle, setIndicatorStyle] = createSignal({
    left: 0,
    width: 0,
  });

  const updateClipIndicators = () => {
    if (!scrollRef) return;
    const { scrollLeft, scrollWidth, clientWidth } = scrollRef;

    const leftAmount = Math.min(scrollLeft, SCROLL_THRESHOLD);
    setLeftOpacity(leftAmount / SCROLL_THRESHOLD);

    const maxScroll = scrollWidth - clientWidth;
    const remainingScroll = maxScroll - scrollLeft;
    const rightAmount = Math.min(remainingScroll, SCROLL_THRESHOLD);
    setRightOpacity(rightAmount / SCROLL_THRESHOLD);
  };

  const updateIndicatorPosition = (element: HTMLElement) => {
    if (!scrollRef || !element) return;
    const listRect = scrollRef.getBoundingClientRect();
    const tabRect = element.getBoundingClientRect();
    setIndicatorStyle({
      left: tabRect.left - listRect.left + scrollRef.scrollLeft,
      width: tabRect.width,
    });
  };

  function setupScrollListeners(element: HTMLDivElement) {
    function listener(e: WheelEvent) {
      e.preventDefault();
      const { deltaX, deltaY } = e;
      const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
      element.scrollLeft += delta;
      updateClipIndicators();
    }
    element.addEventListener('wheel', listener);
    element.addEventListener('scroll', updateClipIndicators);
    updateClipIndicators();
    return () => {
      element.removeEventListener('wheel', listener);
      element.removeEventListener('scroll', updateClipIndicators);
    };
  }

  onCleanup(() => {
    if (scrollCleanup) {
      scrollCleanup();
    }
  });

  onMount(() => {
    setTimeout(() => {
      const activeTab = document.querySelector(`[data-value="${activeTabId()}"]`) as HTMLElement;
      if(activeTab){updateIndicatorPosition(activeTab)}
    }, 0);
  });

  createEffect(() => {
    if (settingsOpen()){
      setTimeout(() => {
        const activeTab = document.querySelector(`[data-value="${activeTabId()}"]`) as HTMLElement;
        if(activeTab){
          updateIndicatorPosition(activeTab);
          updateClipIndicators();
        }
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
        track(TrackingEvents.SETTINGS.CHANGETAB, { tab: tab.value });
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
        <div class="flex flex-col h-full bg-panel border border-edge-muted rounded-sm overflow-hidden">
            <Tabs
              value={activeTabId()}
              onChange={(value: string | undefined) => {
                if(value && (value === 'Account' || value === 'Subscription' || value === 'Appearance' || value === 'Mobile' || value === 'AI Memory' || value === 'Shortcuts')){
                  setActiveTabId(value as SettingsTab);
                  track(TrackingEvents.SETTINGS.CHANGETAB, { tab: value });
                }
              }}
              class="flex flex-col h-full"
            >
              {/* Header with tabs */}
              <div class="relative isolate shrink-0 border-b border-edge-muted">
                <div class="flex items-center px-2">
                  <Show when={!isMobile()}>
                    <DeprecatedIconButton
                      icon={CloseIcon}
                      onClick={closeSettings}
                      tooltip={{ label: 'Close Settings' }}
                      theme="clear"
                      size="sm"
                    />
                  </Show>

                  {/* Left clip boundary indicator */}
                  <div
                    class="absolute pointer-events-none left-0 top-[2.5rem] bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-r-from-0% border-l border-edge-muted transition-opacity duration-150"
                    style={{ opacity: leftOpacity() }}
                  />
                  {/* Right clip boundary indicator */}
                  <div
                    class="absolute pointer-events-none right-0 top-[2.5rem] bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-l-from-0% border-r border-edge-muted transition-opacity duration-150"
                    style={{ opacity: rightOpacity() }}
                  />

                  <Tabs.List
                    class="flex flex-row suppress-css-brackets h-[calc(2.5rem-1px)] bg-panel overflow-x-scroll overscroll-none scrollbar-hidden scroll-shadows-x relative"
                    as="div"
                    ref={(el) => {
                      scrollRef = el;
                      if (el) {
                        scrollCleanup = setupScrollListeners(el);
                      }
                    }}
                  >
                    {/* Sliding indicator line */}
                    <div
                      class="absolute bottom-0 h-px bg-accent z-10 pointer-events-none transition-all duration-150 ease-out"
                      style={{
                        transform: `translateX(${indicatorStyle().left}px)`,
                        width: `${indicatorStyle().width}px`,
                      }}
                    />

                    <For each={settingsTabs()}>
                      {({ value, label }, i) => {
                        const isActive = createMemo(() => value === activeTabId());

                        let ref: HTMLDivElement | undefined;
                        createEffect(() => {
                          if (isActive() && ref) {
                            ref.scrollIntoView({
                              inline: 'end',
                            });
                            updateIndicatorPosition(ref);
                            setTimeout(updateClipIndicators, 0);
                          }
                        });

                        return (
                          <Tabs.Trigger
                            value={value}
                            ref={ref}
                            tabIndex={-1}
                            data-value={value}
                            class="min-w-12 max-w-[40cqw] shrink-0 text-sm relative h-full flex items-center px-2"
                            classList={{
                              'z-1 text-accent text-glow-sm': isActive(),
                              'text-ink-disabled hover:text-accent/70 hover-transition-text': !isActive(),
                            }}
                          >
                            <span class="flex items-center gap-1 w-full">
                              <span class="text-xs font-mono opacity-70 mr-0.5">
                                {(i() + 1).toString()}
                              </span>
                              <span class="truncate">{label}</span>
                            </span>
                          </Tabs.Trigger>
                        );
                      }}
                    </For>
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
