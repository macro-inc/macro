import { Billing } from '@app/features/settings/Billing';
import { Bots } from '@app/features/settings/Bots';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { HeaderIsland } from '@components/app/split-layout/components/HeaderIsland';
import {
  SplitHeaderLeft,
  SplitHeaderRight,
} from '@components/app/split-layout/components/SplitHeader';
import { useLogout } from '@core/auth/logout';
import { TabsInsetDropdown } from '@core/component/TabsInsetDropdown';
import {
  isSoloSettings,
  type SettingsTab,
  settingsTabFromSplitPath,
  useSettingsState,
} from '@core/constant/SettingsState';
import { useSettingsTabs } from '@core/constant/settingsTabsConfig';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import ArrowsIn from '@phosphor/arrows-in.svg';
import ArrowsOut from '@phosphor/arrows-out.svg';
import CaretLeftIcon from '@phosphor/caret-left.svg';
import SignOutIcon from '@phosphor/sign-out.svg';
import { useLocation } from '@solidjs/router';
import { Button, cn, Layer, SideNav } from '@ui';
import {
  createRenderEffect,
  createSignal,
  For,
  onCleanup,
  onMount,
  Show,
  Suspense,
  untrack,
} from 'solid-js';
import { Account } from './Account';
import { Admin } from './Admin';
import { Agent } from './Agent';
import { Appearance } from './Appearance';
import { ConnectedAccounts } from './ConnectedAccounts';
import { Crm } from './Crm';
import { MobileApp } from './MobileApp';
import { Notifications } from './Notifications';
import { Shortcuts } from './Shortcuts';
import { Tags } from './Tags';
import { Team } from './Team';

/** Where the settings panel is mounted, which determines its header chrome. */
export type SettingsVariant = 'split' | 'fullscreen';

// Panel-width breakpoints (the panel can be a full-screen page or a resizable
// split, so we measure the panel itself rather than the viewport). Below
// `COMPACT` the sidebar collapses into a horizontal tab bar; between `COMPACT`
// and `NARROW` the gutter around the content card tightens.
const COMPACT_WIDTH = 660;
const NARROW_WIDTH = 820;

export function SettingsPanelComponentWrapper() {
  const location = useLocation();
  // Sync the active page from the docked split's URL (`settings/<slug>`). Read
  // the live URL reactively — not static mount props — so browser back/forward
  // and direct navigation stay in sync: reconcile reuses this component on
  // same-key changes, so it never remounts to pick up a new tab. Using
  // createRenderEffect (runs during render) matches the previous synchronous set
  // so the layout URL-sync never observes a stale tab on first paint, and the
  // activeTabId read is untracked so a tab click (which sets it, then updates
  // the URL) isn't reverted by this effect firing before the URL catches up.
  createRenderEffect(() => {
    const tab = settingsTabFromSplitPath(location.pathname);
    if (tab && untrack(activeTabId) !== tab) setActiveTabId(tab);
  });
  return <SettingsPanel variant={isSoloSettings() ? 'fullscreen' : 'split'} />;
}

type SettingsPanelProps = {
  hide?: boolean;
  /** Defaults to 'split' so the split-layout mount keeps its existing chrome. */
  variant?: SettingsVariant;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const {
    closeSettings,
    moveSettingsToSplit,
    moveSettingsToSolo,
    activeTabId,
    selectTab,
  } = useSettingsState();
  const { groups, flatTabs, isAvailable } = useSettingsTabs();
  const logout = useLogout();

  const variant = () => props.variant ?? 'split';

  // A tab's content renders only when it's both selected and still available
  // (gating lives solely in the settings tab config).
  const isCurrentTab = (tab: SettingsTab) =>
    activeTabId() === tab && isAvailable(tab);

  // Responsive state, driven by the panel's own width (see breakpoints above).
  const [panelWidth, setPanelWidth] = createSignal(Number.POSITIVE_INFINITY);
  const compact = () => !isTouchDevice() && panelWidth() < COMPACT_WIDTH;
  const narrow = () => !isTouchDevice() && panelWidth() < NARROW_WIDTH;

  // Set up hotkey scope for settings panel
  const [attachHotkeys, settingsHotkeyScope] = useHotkeyDOMScope('settings');
  let settingsContainerRef: HTMLDivElement | undefined;
  let resizeObserver: ResizeObserver | undefined;

  onMount(() => {
    if (!settingsContainerRef) return;
    attachHotkeys(settingsContainerRef);
    // Activate the "settings" hotkey scope immediately so Escape (and the
    // other settings hotkeys) work as soon as the panel opens, rather than
    // only after the user clicks into it (the scope only activates on
    // `focusin`).
    settingsContainerRef.focus();
    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      if (width) setPanelWidth(width);
    });
    resizeObserver.observe(settingsContainerRef);
  });

  onCleanup(() => resizeObserver?.disconnect());

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
        selectTab(tab.tab);
        return true;
      }
    }
    return false;
  }

  function getCurrentTabIndex() {
    return flatTabs().findIndex((tab) => tab.tab === activeTabId());
  }

  function handleNextTab() {
    const tabs = flatTabs();
    const nextIndex =
      getCurrentTabIndex() >= tabs.length - 1 ? 0 : getCurrentTabIndex() + 1;
    navigateToTabIndex(nextIndex);
    return true;
  }

  function handlePreviousTab() {
    const tabs = flatTabs();
    const nextIndex =
      getCurrentTabIndex() <= 0 ? tabs.length - 1 : getCurrentTabIndex() - 1;
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
    function handleNumberKey() {
      return navigateToTabIndex(keyNum - 1);
    }
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
      selectTab(value as SettingsTab);
    }
  };

  // Tab list for the compact segmented control / dropdown.
  const tabItems = () =>
    flatTabs().map((tab) => ({ value: tab.tab, label: tab.label }));

  // "Back to app" — the close affordance for solo settings. Laid out like a nav row.
  const backToApp = () => (
    <button
      type="button"
      onClick={() => closeSettings()}
      class="flex items-center gap-2 px-2 py-1.5 rounded-md text-xs text-ink-extra-muted cursor-default hover:bg-ink/4 hover:text-ink-muted"
    >
      <CaretLeftIcon class="size-4 shrink-0" />
      <span class="whitespace-nowrap">Back to app</span>
    </button>
  );

  const moveToSplitButton = () => (
    <Button
      class="p-1 rounded-md"
      label="Move to split"
      onClick={() => moveSettingsToSplit()}
    >
      <ArrowsIn class="size-4" />
    </Button>
  );

  return (
    <div
      class="size-full flex flex-col outline-none"
      classList={{ invisible: props.hide }}
      tabIndex={0}
      data-settings-panel
      ref={settingsContainerRef}
    >
      <Show when={variant() === 'split'}>
        <SplitHeaderLeft>
          <Show
            when={!isTouchDevice()}
            fallback={
              // On mobile the header strip hosts the tab pills (the bottom
              // accessory region belongs to the global views row). Full-bleed
              // breakout: span the header container (100cqw), opting out of
              // the row's flex sizing, with -ml cancelling the row gutter so
              // the pills scroll device edge to device edge — see
              // MOBILE_TAB_STRIP_CLASS in soup-view-tabs.tsx.
              <PillTabs
                scrollable
                class="-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none"
                contentClass="px-(--mobile-chrome-gutter)"
                items={tabItems()}
                value={activeTabId()}
                onChange={handleTabChange}
              />
            }
          >
            <HeaderIsland>
              <div class="h-full flex gap-3 items-center">
                <h1 class="font-semibold text-ink select-none text-sm shrink-0">
                  Settings
                </h1>
              </div>
            </HeaderIsland>
            {/* When the sidebar collapses, tab selection moves into the split's
                top bar as a dropdown of the current tab. (Rendered directly
                rather than via CollapsibleHeaderItem so the wide segmented
                control never flashes before measuring.) */}
            <Show when={compact()}>
              <div class="mx-2 shrink-0">
                <TabsInsetDropdown
                  list={tabItems()}
                  value={activeTabId()}
                  onChange={handleTabChange}
                />
              </div>
            </Show>
          </Show>
        </SplitHeaderLeft>
        {/* Collapse the other splits so settings becomes the sole one (desktop only). */}
        <Show when={!isMobile()}>
          <SplitHeaderRight>
            <Button
              class="p-1 rounded-lg"
              label="Open fullscreen"
              onClick={() => moveSettingsToSolo()}
            >
              <ArrowsOut class="size-4" />
            </Button>
          </SplitHeaderRight>
        </Show>
      </Show>

      <div class="flex grow min-h-1 overflow-hidden">
        {/* Inline sidebar — hidden once the panel gets too narrow. */}
        <Show when={!isTouchDevice() && !compact()}>
          <SideNav
            class={cn(
              'w-[clamp(208px,20%,248px)] gap-3',
              narrow() ? 'pr-1' : 'pr-2'
            )}
          >
            {/* The full-screen page has no surrounding chrome, so the sidebar
                carries the "back" and "move to split" affordances itself. */}
            <Show when={variant() === 'fullscreen'}>
              <div class="flex items-center justify-between gap-1">
                {backToApp()}
                {moveToSplitButton()}
              </div>
            </Show>
            <For each={groups()}>
              {(group) => (
                <SideNav.Group label={group.label}>
                  <For each={group.items}>
                    {(item) => (
                      <SideNav.Item
                        icon={item.icon}
                        active={activeTabId() === item.tab}
                        onSelect={() => handleTabChange(item.tab)}
                        class="text-xs py-1.5"
                      >
                        {item.label}
                      </SideNav.Item>
                    )}
                  </For>
                </SideNav.Group>
              )}
            </For>
            <div class="mt-auto border-t border-edge-muted pt-2">
              <button
                type="button"
                onClick={() => logout()}
                class="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-xs text-ink-extra-muted cursor-default hover:bg-ink/3 hover:text-ink"
              >
                <SignOutIcon class="size-4 shrink-0" />
                <span class="whitespace-nowrap">Log out</span>
              </button>
            </div>
          </SideNav>
        </Show>

        {/* Content sits in its own subtly-raised, rounded card. The gutter
            around it tightens as the panel narrows, and goes uniform once the
            sidebar collapses. Full-bleed on mobile. */}
        <div
          class="flex-1 min-w-0 overflow-hidden touch:p-0"
          classList={{
            'py-2 pr-2 pl-0': !compact() && !narrow(),
            'py-1 pr-1 pl-0': !compact() && narrow(),
            'p-1': compact(),
          }}
        >
          <Layer depth={1}>
            <div class="relative flex size-full flex-col overflow-hidden rounded-xl border border-ink/[0.06] bg-surface shadow-menu touch:rounded-none touch:border-0 touch:bg-transparent">
              {/* Compact full-screen chrome: no split header to host the tabs,
                  so the sidebar collapses into a top bar here — back / tab
                  dropdown / move-to-split. (Split mode puts the tabs in its
                  header.) */}
              <Show when={variant() === 'fullscreen' && compact()}>
                <div class="flex shrink-0 items-center gap-2 h-13 px-2 border-b border-ink/[0.05]">
                  {backToApp()}
                  <TabsInsetDropdown
                    list={tabItems()}
                    value={activeTabId()}
                    onChange={handleTabChange}
                  />
                  <div class="flex-1" />
                  {moveToSplitButton()}
                </div>
              </Show>

              {/* Full-frame on mobile: the tab pages own the chrome insets
                  inside their scrollers (see SettingsPage in primitives.tsx),
                  so content scrolls under the floating header/dock like every
                  other block instead of being boxed between them. */}
              <div class="relative min-h-0 flex-1 overflow-hidden">
                <Show when={isCurrentTab('Account')}>
                  <Suspense>
                    <Account />
                  </Suspense>
                </Show>
                <Show when={isCurrentTab('Notifications')}>
                  <Notifications />
                </Show>
                <Show when={isCurrentTab('Billing')}>
                  <Suspense>
                    <Billing />
                  </Suspense>
                </Show>
                <Show when={isCurrentTab('Appearance')}>
                  <Appearance />
                </Show>
                <Show when={isCurrentTab('Shortcuts')}>
                  <Shortcuts />
                </Show>
                <Show when={isCurrentTab('Team')}>
                  <Suspense>
                    <Team />
                  </Suspense>
                </Show>
                <Show when={isCurrentTab('Tags')}>
                  <Suspense>
                    <Tags />
                  </Suspense>
                </Show>
                <Show when={isCurrentTab('CRM')}>
                  <Suspense>
                    <Crm />
                  </Suspense>
                </Show>
                <Show when={isCurrentTab('Connected')}>
                  <Suspense>
                    <ConnectedAccounts />
                  </Suspense>
                </Show>
                <Show when={isCurrentTab('Mobile App')}>
                  <MobileApp />
                </Show>
                <Show when={isCurrentTab('Agent')}>
                  <Agent />
                </Show>
                <Show when={isCurrentTab('Bots')}>
                  <Suspense>
                    <Bots />
                  </Suspense>
                </Show>
                <Show when={isCurrentTab('Admin')}>
                  <Admin />
                </Show>
              </div>
            </div>
          </Layer>
        </div>
      </div>
    </div>
  );
}
