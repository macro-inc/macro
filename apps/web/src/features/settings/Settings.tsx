import { SearchBar, ViewShell, ViewSidebar } from '@app/components/view-shell';
import {
  useParams,
  useNavigate as useSplitNavigate,
} from '@app/lib/split-router';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { SplitPanel } from '@components/app/split-panel';
import { useLogout } from '@core/auth/logout';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import {
  type SettingsTabGroup,
  settingsSlugToTab,
  settingsTabToSlug,
  useSettingsTabs,
} from '@core/constant/settingsTabsConfig';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import SignOutIcon from '@phosphor/sign-out.svg';
import { pressHandlers } from '@ui';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  For,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { SettingsTabContent } from './SettingsTabContent';
import { filterSettingsTabGroups } from './settingsSearch';

export function SettingsPanelComponentWrapper() {
  const params = useParams<{ tab?: string }>();

  // Sync the active page from the docked split's URL (`settings/<slug>`). Read
  // the live URL reactively — not static mount props — so browser back/forward
  // and direct navigation stay in sync: reconcile reuses this component on
  // same-key changes, so it never remounts to pick up a new tab. Using
  // createRenderEffect (runs during render) matches the previous synchronous set
  // so the layout URL-sync never observes a stale tab on first paint, and the
  // activeTabId read is untracked so a tab click (which sets it, then updates
  // the URL) isn't reverted by this effect firing before the URL catches up.
  createRenderEffect(() => {
    const tab = settingsSlugToTab(params.tab ?? '') ?? 'Account';

    if (untrack(activeTabId) !== tab) setActiveTabId(tab);
  });

  return (
    <Show when={!isMobile()} fallback={<MobileSettingsDeepLink />}>
      <SettingsPanel />
    </Show>
  );
}

/** Old settings URLs still open their section, over the restored app surface. */
function MobileSettingsDeepLink() {
  const params = useParams<{ tab?: string }>();
  const { openSettings, restoreMobileDeepLink } = useSettingsState();

  onMount(() => {
    openSettings(settingsSlugToTab(params.tab ?? '') ?? 'Account');
    restoreMobileDeepLink();
  });

  return null;
}

type SettingsPanelProps = {
  hide?: boolean;
};

export function SettingsPanel(props: SettingsPanelProps) {
  const { closeSettings, activeTabId, selectTab } = useSettingsState();
  const splitNavigate = useSplitNavigate();
  const { searchGroups, flatTabs } = useSettingsTabs();
  const logout = useLogout();

  const activeNavigationTab = () =>
    activeTabId() === 'Harness' ? 'Agents' : activeTabId();

  const [searchQuery, setSearchQuery] = createSignal('');

  const filteredGroups = createMemo(() =>
    filterSettingsTabGroups(searchGroups(), searchQuery())
  );

  // Runtimes is a search-only row. While it is on screen, highlight that row
  // for the Harness tab; otherwise the standing Agents row stands in for it.
  const showsHarnessResult = () =>
    filteredGroups().some((group) =>
      group.items.some((item) => item.tab === 'Harness')
    );
  const isItemActive = (tab: SettingsTab) =>
    activeTabId() === tab ||
    (tab === 'Agents' && activeTabId() === 'Harness' && !showsHarnessResult());

  // Set up hotkey scope for settings panel
  const [attachHotkeys, settingsHotkeyScope] = useHotkeyDOMScope('settings');
  let settingsContainerRef: HTMLDivElement | undefined;

  onMount(() => {
    if (!settingsContainerRef) return;
    attachHotkeys(settingsContainerRef);
    // Activate the "settings" hotkey scope immediately so Escape (and the
    // other settings hotkeys) work as soon as the panel opens, rather than
    // only after the user clicks into it (the scope only activates on
    // `focusin`).
    settingsContainerRef.focus();
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

  const selectRoutedTab = (tab: SettingsTab) => {
    selectTab(tab, (next) => {
      splitNavigate(`/settings/${settingsTabToSlug(next)}`);
    });
  };

  // Helper to navigate to a tab by index
  function navigateToTabIndex(index: number): boolean {
    const tabs = flatTabs();
    if (index >= 0 && index < tabs.length) {
      const tab = tabs[index];
      if (tab) {
        selectRoutedTab(tab.tab);
        return true;
      }
    }
    return false;
  }

  function getCurrentTabIndex() {
    return flatTabs().findIndex((tab) => tab.tab === activeNavigationTab());
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
      selectRoutedTab(value as SettingsTab);
    }
  };

  // Tab list for the touch pill strip.
  const tabItems = () =>
    flatTabs().map((tab) => ({ value: tab.tab, label: tab.label }));

  const content = () => (
    <Show when={activeTabId()}>
      {(tab) => <SettingsTabContent tab={tab()} />}
    </Show>
  );

  return (
    <div
      class="size-full flex flex-col outline-none"
      classList={{ invisible: props.hide }}
      tabIndex={0}
      data-settings-panel
      ref={settingsContainerRef}
    >
      <Show
        when={!isTouchDevice()}
        fallback={
          <>
            <SplitHeaderLeft>
              {/* On touch the header strip hosts the tab pills (the bottom
                  accessory region belongs to the global views row).
                  Full-bleed breakout: span the header container (100cqw),
                  opting out of the row's flex sizing, with -ml cancelling the
                  row gutter so the pills scroll device edge to device edge —
                  see MOBILE_TAB_STRIP_CLASS in soup-view-tabs.tsx. */}
              <PillTabs
                scrollable
                class="-ml-(--mobile-chrome-gutter) w-[100cqw] max-w-none flex-none"
                contentClass="px-(--mobile-chrome-gutter)"
                items={tabItems()}
                value={activeNavigationTab()}
                onChange={handleTabChange}
              />
            </SplitHeaderLeft>
            {/* Full-frame on touch: the tab pages own the chrome insets
                inside their scrollers (see SettingsPage in primitives.tsx), so
                content scrolls under the floating header/dock like every other
                block instead of being boxed between them. */}
            <div class="relative min-h-0 flex-1 overflow-hidden">
              {content()}
            </div>
          </>
        }
      >
        <SplitPanel.Root>
          <SplitPanel.Body>
            <ViewShell.Root
              asidePreferenceKey="settings"
              resizable
              aside={{ preserveDuringResize: false }}
              main={{ preferredWidth: 720 }}
            >
              <ViewShell.Aside>
                <SettingsSidebar
                  groups={filteredGroups()}
                  searchQuery={searchQuery()}
                  onSearchQueryChange={setSearchQuery}
                  isItemActive={isItemActive}
                  onSelect={selectRoutedTab}
                  onLogout={() => logout()}
                />
              </ViewShell.Aside>
              <ViewShell.Main>
                <ViewShell.TopBar />
                <div class="relative min-h-0 flex-1 overflow-hidden">
                  {content()}
                </div>
              </ViewShell.Main>
            </ViewShell.Root>
          </SplitPanel.Body>
        </SplitPanel.Root>
      </Show>
    </div>
  );
}

/**
 * Settings' inner navigation, laid out like every other view's sidebar: a
 * title bar, a search field, the grouped section pills, and Log out pinned to
 * the bottom.
 */
function SettingsSidebar(props: {
  groups: SettingsTabGroup[];
  searchQuery: string;
  onSearchQueryChange: (query: string) => void;
  isItemActive: (tab: SettingsTab) => boolean;
  onSelect: (tab: SettingsTab) => void;
  onLogout: () => void;
}) {
  return (
    <ViewSidebar.Root aria-label="Settings navigation">
      <ViewSidebar.Header>
        <div class="flex min-w-0 items-center gap-1">
          <ViewSidebar.CloseButton class="shrink-0" />
          <ViewSidebar.Title>Settings</ViewSidebar.Title>
        </div>
      </ViewSidebar.Header>

      <ViewSidebar.Primary>
        <SearchBar
          label="Search settings"
          placeholder="Search"
          autocomplete="off"
          value={props.searchQuery}
          onValueChange={props.onSearchQueryChange}
          class="h-9"
        />
      </ViewSidebar.Primary>

      <ViewSidebar.Content class="gap-4">
        <Show
          when={props.groups.length > 0}
          fallback={
            <div class="py-4 text-center text-sm text-ink-muted">
              No settings found
            </div>
          }
        >
          <For each={props.groups}>
            {(group) => (
              <section class="flex min-w-0 flex-col gap-0.5">
                <h2 class="flex h-7 min-w-0 items-center px-(--sidebar-item-inset) text-sm font-medium text-ink-extra-muted">
                  <span class="truncate">{group.label}</span>
                </h2>
                <ViewSidebar.Nav aria-label={group.label}>
                  <For each={group.items}>
                    {(item) => (
                      <ViewSidebar.Item
                        active={props.isItemActive(item.tab)}
                        {...pressHandlers(() => props.onSelect(item.tab))}
                      >
                        <ViewSidebar.Icon>
                          <Dynamic component={item.icon} class="size-4" />
                        </ViewSidebar.Icon>
                        <span class="truncate">{item.label}</span>
                      </ViewSidebar.Item>
                    )}
                  </For>
                </ViewSidebar.Nav>
              </section>
            )}
          </For>
        </Show>
      </ViewSidebar.Content>

      <ViewSidebar.Footer class="py-(--sidebar-gutter)">
        <ViewSidebar.Item {...pressHandlers(() => props.onLogout())}>
          <ViewSidebar.Icon>
            <SignOutIcon class="size-4" />
          </ViewSidebar.Icon>
          <span class="truncate">Log out</span>
        </ViewSidebar.Item>
      </ViewSidebar.Footer>
    </ViewSidebar.Root>
  );
}
