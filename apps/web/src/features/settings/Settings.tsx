import { useViewShell, ViewShell } from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import {
  useParams,
  useNavigate as useSplitNavigate,
} from '@app/lib/split-router';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { SplitHeaderLeft } from '@components/app/split-layout/components/SplitHeader';
import { SplitPanel } from '@components/app/split-panel';
import { useLogout } from '@core/auth/logout';
import { enableEmailSignatures } from '@core/constant/featureFlags';
import {
  type SettingsTab,
  useSettingsState,
} from '@core/constant/SettingsState';
import {
  settingsSlugToTab,
  settingsTabToSlug,
  useSettingsTabs,
} from '@core/constant/settingsTabsConfig';
import { registerHotkey, useHotkeyDOMScope } from '@core/hotkey/hotkeys';
import type { ValidHotkey } from '@core/hotkey/types';
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  onMount,
  Show,
  untrack,
} from 'solid-js';
import { SettingsSearchTarget } from './components/settings-search-target';
import { SettingsSidebar } from './components/settings-sidebar';
import {
  type SettingsSearchResult,
  searchSettings,
} from './core/settings-search';
import { SettingsTabContent } from './SettingsTabContent';

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
  const { groups, searchGroups, flatTabs } = useSettingsTabs();
  const logout = useLogout();
  const signatures = useFeatureFlag(enableEmailSignatures);

  const activeNavigationTab = activeTabId;

  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchSelection, setSearchSelection] =
    createSignal<SettingsSearchResult>();
  const searchResults = createMemo(() =>
    searchSettings(searchGroups(), searchQuery(), {
      emailSignatures: signatures().enabled,
    })
  );

  const isItemActive = (tab: SettingsTab) => activeTabId() === tab;

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
    if (searchQuery()) {
      setSearchQuery('');
      setSearchSelection(undefined);
    } else closeSettings();
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
    setSearchSelection(undefined);
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
      {(tab) => (
        <SettingsSearchTarget
          result={
            searchSelection()?.tab === tab() ? searchSelection() : undefined
          }
        >
          <SettingsTabContent tab={tab()} />
        </SettingsSearchTarget>
      )}
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
              main={{ preferredWidth: 960 }}
            >
              <ViewShell.Aside>
                <SettingsSidebar
                  groups={groups()}
                  results={searchResults()}
                  selectedResultId={
                    searchSelection()?.tab === activeTabId()
                      ? searchSelection()?.id
                      : undefined
                  }
                  onSelectResult={(result) => {
                    selectRoutedTab(result.tab);
                    setSearchSelection({ ...result });
                  }}
                  searchQuery={searchQuery()}
                  onSearchQueryChange={setSearchQuery}
                  isItemActive={isItemActive}
                  onSelect={selectRoutedTab}
                  onLogout={() => logout()}
                />
              </ViewShell.Aside>
              <ViewShell.Main>
                <SettingsNavigationBar />
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

/** Reserve toolbar space only when the navigation controls are visible. */
function SettingsNavigationBar() {
  const shell = useViewShell();
  return (
    <Show when={shell.aside.isCollapsed() || shell.aside.isOverlay()}>
      <ViewShell.TopBar />
    </Show>
  );
}
