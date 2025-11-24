import { type SettingsTab, useSettingsState, settingsSpotlight, setSettingsSpotlight } from '@core/constant/SettingsState';
import { createEffect, createMemo, createSignal, For, onCleanup, Show } from 'solid-js';
import { DEV_MODE_ENV, ENABLE_AI_MEMORY } from '@core/constant/featureFlags';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { MacroPermissions, usePermissions } from '@service-gql/client';
import Organization from './Organization/Organization';
import { withAnalytics } from '@coparse/analytics';
import { useOrganizationName } from '@core/user';
import { AiMemory } from './AiMemory/AiMemory';
import { Subscription } from './Subscription';
import { Appearance } from './Appearance';
import { Tabs } from '@kobalte/core/tabs';
import { Account } from './Account';

export const [viewportOffset, setViewportOffset] = createSignal(0);

const SCROLL_THRESHOLD = 10;

const { track, TrackingEvents } = withAnalytics();

export function SettingsContent() {
  const { activeTabId, setActiveTabId } = useSettingsState();
  const permissions = usePermissions();
  const orgName = useOrganizationName();

  let scrollRef!: HTMLDivElement;
  let scrollCleanup: (() => void) | undefined;
  const [leftOpacity, setLeftOpacity] = createSignal(0);
  const [rightOpacity, setRightOpacity] = createSignal(0);
  const [indicatorStyle, setIndicatorStyle] = createSignal({left: 0, width: 0 });

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

  function setupScrollListeners(element: HTMLDivElement){
    function listener(e: WheelEvent){
      e.preventDefault();
      const { deltaX, deltaY } = e;
      const delta = Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
      element.scrollLeft += delta;
      updateClipIndicators();
    };
    element.addEventListener('wheel', listener);
    element.addEventListener('scroll', updateClipIndicators);
    updateClipIndicators();
    return () => {
      element.removeEventListener('wheel', listener);
      element.removeEventListener('scroll', updateClipIndicators);
    };
  };

  onCleanup(() => {
    if(scrollCleanup){
      scrollCleanup();
    }
  });

  /*
  very verbose way to choose which tabs should be shown
  this will be replaced with <Show when={}>
  */
  const settingsTabs = createMemo(() => {
    const tabs: {value: string; label: string }[] = [];

    tabs.push({value: 'Appearance', label: 'Appearance'});

    tabs.push({value: 'Account', label: 'Account'});

    if(!orgName() && !isNativeMobilePlatform()){
      tabs.push({value: 'Subscription', label: 'Subscription'})
    }

    if(orgName() && permissions()?.includes(MacroPermissions.WriteItPanel)){
      tabs.push({value: 'Organization', label: 'Organization'})
    }



    if(isNativeMobilePlatform() && DEV_MODE_ENV){
      tabs.push({ value: 'Mobile', label: 'Mobile Dev Tools' })
    }
    if(ENABLE_AI_MEMORY){
      tabs.push({ value: 'AI Memory', label: 'AI Memory' })
    }

    return tabs;
  });

  return (
    <div class="h-full flex flex-col bg-panel text-ink">
      <Tabs
        value={activeTabId()}
        onChange={(value: string | undefined) => {
          if(value && (value === 'Account' || value === 'Subscription' || value === 'Organization' || value === 'Appearance' || value === 'Mobile' || value === 'AI Memory')){
            setActiveTabId(value as SettingsTab);
            track(TrackingEvents.SETTINGS.CHANGETAB, { tab: value });
          }
        }}
        class="flex flex-col h-full"
      >
        <div class="relative isolate shrink-0">
          {/* Left clip boundary indicator */}
          <div
            class="absolute pointer-events-none left-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-r-from-0% border-l border-edge-muted transition-opacity duration-150"
            style={{ opacity: leftOpacity() }}
          />
          {/* Right clip boundary indicator */}
          <div
            class="absolute pointer-events-none right-0 top-px bottom-px w-3 z-2 pattern-diagonal-4 pattern-edge mask-l-from-0% border-r border-edge-muted transition-opacity duration-150"
            style={{ opacity: rightOpacity() }}
          />

          <Tabs.List
            class="flex flex-row suppress-css-brackets h-full bg-panel overflow-x-scroll overscroll-none scrollbar-hidden scroll-shadows-x relative"
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
                    class="min-w-12 max-w-[40cqw] shrink-0 text-sm relative h-full flex items-center px-2"
                    classList={{
                      'z-1 border-y border-edge-muted text-accent text-glow-sm':
                        isActive(),
                      'border-y border-edge-muted text-ink-disabled hover:text-accent/70 hover-transition-text':
                        !isActive(),
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
        </div>

        <div class="flex-1 p-6 overflow-y-scroll">
          <Tabs.Content value="Account" class="h-full">
            <Account />
          </Tabs.Content>
          <Show when={!orgName() && !isNativeMobilePlatform()}>
            <Tabs.Content value="Subscription" class="h-full">
              <Subscription />
            </Tabs.Content>
          </Show>
          <Show when={ orgName() && permissions()?.includes(MacroPermissions.WriteItPanel)}>
            <Tabs.Content value="Organization" class="h-full">
              <Organization />
            </Tabs.Content>
          </Show>
          <Tabs.Content value="Appearance" class="h-full">
            <Appearance />
          </Tabs.Content>

          <Show when={ENABLE_AI_MEMORY}>
            <Tabs.Content value="AI Memory" class="h-full">
              <AiMemory />
            </Tabs.Content>
          </Show>
        </div>
      </Tabs>
    </div>
  );
}
