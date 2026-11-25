import {
  useViewShell,
  ViewShell,
  ViewSidebar,
} from '@app/components/view-shell';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { t } from '@app/lib/i18n';
import {
  useParams,
  useNavigate as useSplitNavigate,
} from '@app/lib/split-router';
import { MobileTopEdgeFade } from '@components/app/mobile/MobileEdgeFade';
import { PillTabs } from '@components/app/mobile/PillTabs';
import { SplitPanel } from '@components/app/split-panel';
import { enableAgentNotifications } from '@core/constant/featureFlags';
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
import { isMobile } from '@core/mobile/isMobile';
import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { activeTabId, setActiveTabId } from '@core/signal/settingsTab';
import { fireAndForget } from '@core/util/fireAndForget';
import { isPlatform } from '@core/util/platform';
import { useOutlookAvailable } from '@queries/auth/outlook-link';
import { useMacroComputersRollout } from '@queries/computers/computers';
import { useSearchParams } from '@solidjs/router';
import {
  createMemo,
  createRenderEffect,
  createSignal,
  type JSX,
  Match,
  onMount,
  Show,
  Switch,
  untrack,
} from 'solid-js';
import { SettingsSearchTarget } from './components/settings-search-target';
import { SettingsSidebar } from './components/settings-sidebar';
import {
  COMPUTER_SETUP_PARAM,
  parseComputerSetupParam,
  requestComputerSetup,
} from './computers/primitives/setup-request';
import {
  type SettingsSearchResult,
  searchSettings,
} from './core/settings-search';
import { SettingsTabContent } from './SettingsTabContent';
import { TeamSidebarAction } from './TeamSidebarAction';
import { useTeamSettingsGroups } from './teamSettingsGroups';

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
  const [searchParams] = useSearchParams();
  const { openSettings, restoreMobileDeepLink } = useSettingsState();

  onMount(() => {
    // Restoring the app surface drops the URL, so a computer setup link is
    // handed to Settings → Machines first.
    const computerId = parseComputerSetupParam(
      searchParams[COMPUTER_SETUP_PARAM]
    );
    if (computerId) requestComputerSetup(computerId);
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
  const { groups, searchGroups } = useSettingsTabs();
  const navGroups = useTeamSettingsGroups(groups);
  // Hotkeys and touch pills follow the visible nav, which hides team pages
  // from people without a team.
  const navTabs = createMemo(() => navGroups().flatMap((group) => group.items));
  const agentNotifications = useFeatureFlag(enableAgentNotifications);
  const outlook = useOutlookAvailable();
  const macroComputers = useMacroComputersRollout();

  const activeNavigationTab = activeTabId;

  const [searchQuery, setSearchQuery] = createSignal('');
  const [searchSelection, setSearchSelection] =
    createSignal<SettingsSearchResult>();
  const searchResults = createMemo(() =>
    searchSettings(searchGroups(), searchQuery(), {
      outlook: outlook(),
      macroComputers: macroComputers().enabled,
      desktopDownload: !isPlatform('desktop'),
      agentNotifications: agentNotifications().enabled,
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
    description: () => t('settingsNav.closeSettings'),
    scopeId: settingsHotkeyScope,
    hotkey: 'escape',
  });

  const selectRoutedTab = (tab: SettingsTab) => {
    setSearchSelection(undefined);
    selectTab(tab, (next) => {
      fireAndForget(
        splitNavigate(`/settings/${settingsTabToSlug(next)}`),
        'settings'
      );
    });
  };

  const handleTabChange = (value: string) => {
    if (navTabs().some((tab) => tab.tab === value)) {
      selectRoutedTab(value as SettingsTab);
    }
  };

  // Tab list for the touch pill strip.
  const tabItems = () =>
    navTabs().map((tab) => ({ value: tab.tab, label: tab.label }));

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
      <SplitPanel.Root>
        <SplitPanel.Body>
          <ViewShell.Root
            asidePreferenceKey="settings"
            asidePinned={isTouchDevice()}
            resizable
            aside={{ preserveDuringResize: false }}
            main={{ preferredWidth: 960 }}
          >
            <ViewShell.Aside>
              <SettingsSidebar
                groups={navGroups()}
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
                searchable={!isTouchDevice()}
                searchQuery={searchQuery()}
                onSearchQueryChange={setSearchQuery}
                isItemActive={isItemActive}
                onSelect={selectRoutedTab}
                action={<TeamSidebarAction />}
              />
            </ViewShell.Aside>
            <ViewShell.Main class="relative">
              <SettingsMainContent
                tabs={tabItems()}
                value={activeNavigationTab()}
                onTabChange={handleTabChange}
              >
                {content()}
              </SettingsMainContent>
            </ViewShell.Main>
          </ViewShell.Root>
        </SplitPanel.Body>
      </SplitPanel.Root>
    </div>
  );
}

type SettingsMainContentProps = {
  tabs: { value: string; label: string }[];
  value: string | undefined;
  onTabChange: (value: string) => void;
  children: JSX.Element;
};

/**
 * Wide touch panes keep the sidebar docked beside the page, like desktop;
 * narrow touch panes switch pages from pills and open the sidebar as an overlay.
 */
function SettingsMainContent(props: SettingsMainContentProps) {
  const shell = useViewShell();
  const showPills = () => isTouchDevice() && !!shell.breakpoints.narrow?.();
  return (
    <>
      <Switch>
        <Match when={!isTouchDevice()}>
          <SettingsNavigationBar />
        </Match>
        <Match when={showPills()}>
          <header class="pointer-events-none absolute inset-x-0 top-0 z-split-panel-chrome flex min-w-0 pt-[calc(var(--safe-top,0px)+0.5rem)]">
            <PillTabs
              scrollable
              class="w-full"
              contentClass="px-(--mobile-chrome-gutter)"
              leading={
                <ViewSidebar.Toggle action="expand" presentation="pill" />
              }
              items={props.tabs}
              value={props.value}
              onChange={props.onTabChange}
            />
          </header>
        </Match>
      </Switch>
      <div
        class="relative min-h-0 flex-1 overflow-hidden"
        style={
          showPills()
            ? {
                '--mobile-content-inset-top':
                  'calc(var(--safe-top, 0px) + 3.75rem)',
              }
            : undefined
        }
      >
        {props.children}
        <Show when={isTouchDevice()}>
          <MobileTopEdgeFade />
        </Show>
      </div>
    </>
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
