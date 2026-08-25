import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { CommandState } from '@app/features/command';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { useAnalytics } from '@app/lib/analytics/analytics-context';
import { useFeatureFlag } from '@app/lib/analytics/posthog';
import { globalSplitManager } from '@app/signal/splitLayout';
import {
  buildBrainWorkspacePath,
  getLastBrainWorkspaceSelection,
} from '@components/app/split-layout/brainWorkspaceRoute';
import { useSplitLayout } from '@components/app/split-layout/layout';
import {
  ENABLE_CRM_FLAG,
  ENABLE_CRM_OVERRIDE,
} from '@core/constant/featureFlags';
import { useSettingsState } from '@core/constant/SettingsState';
import { openExternalUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import LogoIcon from '@icon/macro-logo.svg';
import GridIcon from '@phosphor/dots-nine.svg';
import GearIcon from '@phosphor/gear.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { useNavigate } from '@solidjs/router';
import { cn, Dropdown, Tooltip } from '@ui';
import { createMemo, createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  TOP_BAR_SPLIT_DESTINATIONS,
  TOP_BAR_SUB_APPS,
  TOP_BAR_VIEWS,
  type TopBarDestination,
} from './topbar-destinations';

/** Absolute app URL for a destination, for opening it in its own tab. */
function destinationUrl(destination: TopBarDestination) {
  return `${getWebOrigin()}/app${destination.path}`;
}

/**
 * V3's app chrome: a 56px top bar in place of the V2 sidebar. Logo and search
 * sit at the left, the primary views run down the middle with Facebook's
 * filled-icon-plus-underline active state, and the right cluster opens the
 * companion splits and the sub-app grid.
 */
export function ExperimentalAppTopBar() {
  const analytics = useAnalytics();
  const crmFlag = useFeatureFlag(ENABLE_CRM_FLAG, {
    enabledOverride: ENABLE_CRM_OVERRIDE,
  });
  const layout = useSplitLayout();
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();
  const [appsOpen, setAppsOpen] = createSignal(false);

  const activeContent = createMemo(() =>
    globalSplitManager()?.activeSplit()?.content()
  );

  const isActive = (destination: TopBarDestination) => {
    const content = activeContent();
    if (!content) return false;
    return (
      content.type === destination.content.type &&
      content.id === destination.content.id
    );
  };

  const isVisible = (destination: TopBarDestination) =>
    !destination.requiresCrmFlag || crmFlag().enabled;

  const visibleViews = () => TOP_BAR_VIEWS.filter(isVisible);
  const visibleSubApps = () => TOP_BAR_SUB_APPS.filter(isVisible);

  const openSearch = () => {
    analytics.track('sidebar_click', { surface: 'topbar', view: 'search' });
    analytics.track('command_menu_open', { from: 'topbar_search' });
    CommandState.open();
  };

  /** Center views replace the active split; shift-click opens a new one. */
  const openView = (destination: TopBarDestination, event: MouseEvent) => {
    if (
      destination.id === 'brain' &&
      !event.shiftKey &&
      !isActive(destination)
    ) {
      analytics.track('sidebar_click', {
        surface: 'topbar',
        view: destination.id,
      });
      navigate(buildBrainWorkspacePath(getLastBrainWorkspaceSelection()));
      globalSplitManager()?.returnFocus();
      return;
    }

    if (!event.shiftKey && isActive(destination)) {
      globalSplitManager()?.returnFocus();
      return;
    }

    analytics.track('sidebar_click', {
      surface: 'topbar',
      view: destination.id,
    });
    layout.openWithSplit(destination.content, {
      preferNewSplit: event.shiftKey,
      mergeHistory: false,
      allowDuplicate: true,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

  /**
   * The right cluster is for companions to whatever is already open, so these
   * always land in their own split — or focus the one already showing them.
   */
  const openAsSplit = (destination: TopBarDestination) => {
    analytics.track('sidebar_click', {
      surface: 'topbar',
      view: destination.id,
    });
    layout.openWithSplit(destination.content, {
      preferNewSplit: true,
      mergeHistory: false,
      allowDuplicate: false,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

  const openInNewTab = (destination: TopBarDestination) => {
    analytics.track('sidebar_click', {
      surface: 'topbar_apps',
      view: destination.id,
    });
    setAppsOpen(false);
    openExternalUrl(destinationUrl(destination));
  };

  return (
    // h-14 is Facebook's 56px bar: V3 is desktop-only, and there the root
    // font-size is the standard 16px (touch opts into Dynamic Type instead).
    <header class="grid h-14 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-stretch gap-2 border-b border-edge-muted bg-surface px-3">
      <div class="flex min-w-0 items-center gap-2">
        <Tooltip label="Home">
          <button
            type="button"
            aria-label="Home"
            class="flex size-10 shrink-0 items-center justify-center rounded-full text-accent outline-none hover:bg-ink/5 focus-visible:ring-2 focus-visible:ring-accent/40"
            onClick={() => navigate(DEFAULT_ROUTE)}
          >
            <LogoIcon class="size-6" />
          </button>
        </Tooltip>
        <button
          type="button"
          class="flex h-10 w-60 min-w-0 shrink items-center gap-2 rounded-full bg-ink/5 px-3 text-left text-sm text-ink-muted outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
          onClick={openSearch}
        >
          <SearchIcon class="size-4 shrink-0" />
          <span class="truncate">Search Macro</span>
        </button>
      </div>

      <nav aria-label="App views" class="flex items-stretch justify-center">
        <For each={visibleViews()}>
          {(destination) => (
            <Tooltip label={destination.label}>
              <button
                type="button"
                aria-label={destination.label}
                aria-current={isActive(destination) ? 'page' : undefined}
                class={cn(
                  'group/top-bar-view relative flex h-full w-[76px] items-center justify-center px-1 outline-none',
                  isActive(destination) ? 'text-accent' : 'text-ink-muted'
                )}
                onMouseDown={(event) => {
                  if (event.button === 0) event.preventDefault();
                }}
                onClick={(event) => openView(destination, event)}
              >
                <span
                  class={cn(
                    'flex h-10 w-full items-center justify-center rounded-lg transition-colors',
                    !isActive(destination) &&
                      'group-hover/top-bar-view:bg-ink/5 group-hover/top-bar-view:text-ink',
                    'group-focus-visible/top-bar-view:ring-2 group-focus-visible/top-bar-view:ring-accent/40'
                  )}
                >
                  <Dynamic
                    component={
                      isActive(destination)
                        ? destination.filledIcon
                        : destination.icon
                    }
                    class="size-6"
                  />
                </span>
                <Show when={isActive(destination)}>
                  <span class="pointer-events-none absolute inset-x-0 -bottom-px h-[3px] rounded-t-sm bg-accent" />
                </Show>
              </button>
            </Tooltip>
          )}
        </For>
      </nav>

      <div class="flex min-w-0 items-center justify-end gap-1.5">
        <SidebarCreateMenu
          isSlim={() => true}
          variant="icon"
          icon="plus"
          placement="bottom-end"
          filled
          large
          onAgentSelect={() => navigate('/chat')}
        />
        <For each={TOP_BAR_SPLIT_DESTINATIONS}>
          {(destination) => (
            <Tooltip label={`Open ${destination.label} in a split`}>
              <button
                type="button"
                aria-label={`Open ${destination.label} in a split`}
                class={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/5 outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40',
                  isActive(destination) ? 'text-accent' : 'text-ink'
                )}
                onClick={() => openAsSplit(destination)}
              >
                <Dynamic
                  component={
                    isActive(destination)
                      ? destination.filledIcon
                      : destination.icon
                  }
                  class="size-5"
                />
              </button>
            </Tooltip>
          )}
        </For>
        <Dropdown
          open={appsOpen()}
          onOpenChange={setAppsOpen}
          placement="bottom-end"
        >
          <Tooltip label="Macro apps">
            <Dropdown.Trigger
              class="!size-10 shrink-0 rounded-full bg-ink/5 px-0"
              aria-label="Macro apps"
            >
              <GridIcon class="size-5" />
            </Dropdown.Trigger>
          </Tooltip>
          <Dropdown.Content class="w-72">
            <Dropdown.Group class="grid grid-cols-3 gap-1 p-2">
              <For each={visibleSubApps()}>
                {(destination) => (
                  <Dropdown.Item
                    class="flex h-auto flex-col items-center gap-1.5 rounded-lg px-1 py-3 text-center"
                    onSelect={() => openInNewTab(destination)}
                  >
                    <Dynamic
                      component={destination.icon}
                      class="size-6 text-ink"
                    />
                    <span class="w-full truncate text-xs text-ink-muted">
                      {destination.label}
                    </span>
                  </Dropdown.Item>
                )}
              </For>
            </Dropdown.Group>
          </Dropdown.Content>
        </Dropdown>
        <Tooltip label="Settings">
          <button
            type="button"
            aria-label="Settings"
            class="flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
            onClick={() => openSettings('Account')}
          >
            <GearIcon class="size-5" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
