import { createEffect, createMemo, createSignal, For, onCleanup, onMount, Show, Suspense } from 'solid-js';
import { type SettingsTab, useSettingsState } from '@core/constant/SettingsState';
import { SplitlikeContainer } from '../split-layout/components/SplitContainer';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import CloseIcon from '@phosphor-icons/core/regular/x.svg?component-solid';
import { usePermissions } from '@queries/auth/user-info';
import { DEV_MODE_ENV } from '@core/constant/featureFlags';
import { DeprecatedIconButton } from '@core/component/DeprecatedIconButton';
import ContractIcon from '@icon/regular/arrows-in.svg';
import Organization from './Organization/Organization';
import ExpandIcon from '@icon/regular/arrows-out.svg';
import { withAnalytics } from '@coparse/analytics';
import { useOrganizationName } from '@core/user';
import { Subscription } from './Subscription';
import { Appearance } from './Appearance';
import { Tabs } from '@kobalte/core/tabs';
import { Account } from './Account';
import { Inbox } from './Inbox';
import { Shortcuts } from './Shortcuts';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { isMobileWidth } from '@core/mobile/mobileWidth';

const SCROLL_THRESHOLD = 10;

const { track, TrackingEvents } = withAnalytics();

type SettingsPanelProps = {
  hide?: boolean;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const { settingsOpen, closeSettings, activeTabId, setActiveTabId } = useSettingsState();
  const permissions = usePermissions();
  const orgName = useOrganizationName();
  const [spotlight, setSpotlight] = createSignal(false);

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
      {value: 'Shortcuts', label: 'Shortcuts'}
    ];

    if(!orgName() && !isNativeMobilePlatform()){tabs.push({value: 'Subscription', label: 'Subscription'})}
    if(orgName() && permissions()?.includes('WriteItPanel')){tabs.push({value: 'Organization', label: 'Organization'})}
    if(isNativeMobilePlatform() && DEV_MODE_ENV){tabs.push({ value: 'Mobile', label: 'Mobile Dev Tools' })}
    if(DEV_MODE_ENV){tabs.push({ value: 'Inbox', label: 'Inbox' })}

    return tabs;
  });

  return (
    <div
      class="size-full"
      classList={{
        invisible: props.hide,
      }}
    >
      <SplitlikeContainer
        setSpotlight={setSpotlight}
        spotlight={spotlight}
        tr={!spotlight()}
      >
        <div class="flex flex-col h-full bg-panel">
            <Tabs
              value={activeTabId()}
              onChange={(value: string | undefined) => {
                if(value && (value === 'Account' || value === 'Subscription' || value === 'Organization' || value === 'Appearance' || value === 'Mobile' || value === 'AI Memory' || value === 'Inbox' || value === 'Shortcuts')){
                  setActiveTabId(value as SettingsTab);
                  track(TrackingEvents.SETTINGS.CHANGETAB, { tab: value });
                }
              }}
              class="flex flex-col h-full"
            >
              {/* Header with tabs */}
              <div class="relative isolate shrink-0 border-b border-edge-muted">
                <div class="flex items-center px-2">
                  <Show when={!isTouchDevice() || !isMobileWidth()}>
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

                  <Show when={!isTouchDevice() || !isMobileWidth()}>
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
                <Show when={!orgName() && !isNativeMobilePlatform()}>
                  <Tabs.Content value="Subscription" class="absolute inset-0">
                    <Subscription />
                  </Tabs.Content>
                </Show>
                <Show when={ orgName() && permissions()?.includes('WriteItPanel')}>
                  <Tabs.Content value="Organization" class="absolute inset-0">
                    <Organization />
                  </Tabs.Content>
                </Show>
                <Tabs.Content value="Appearance" class="absolute inset-0">
                  <Appearance />
                </Tabs.Content>
                <Tabs.Content value="Shortcuts" class="absolute inset-0">
                  <Shortcuts />
                </Tabs.Content>
                <Show when={DEV_MODE_ENV}>
                  <Tabs.Content value="Inbox" class="absolute inset-0">
                    <Inbox />
                  </Tabs.Content>
                </Show>
              </div>
            </Tabs>
          </div>
        </SplitlikeContainer>
      </div>
  );
}
