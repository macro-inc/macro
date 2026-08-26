import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { CommandState } from '@app/features/command';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { activeViewSearch } from '@app/features/next-soup/soup-view/active-view-search';
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
import { registerHotkey } from '@core/hotkey/hotkeys';
import { openExternalUrl } from '@core/util/url';
import { getWebOrigin } from '@core/util/webOrigin';
import LogoIcon from '@icon/macro-logo.svg';
import GridIcon from '@phosphor/dots-nine.svg';
import GearIcon from '@phosphor/gear.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { useNavigate } from '@solidjs/router';
import { cn, Dropdown, Hotkey, Tooltip } from '@ui';
import {
  createEffect,
  createMemo,
  createSignal,
  For,
  onCleanup,
  Show,
} from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  TOP_BAR_SPLIT_DESTINATIONS,
  TOP_BAR_SUB_APPS,
  TOP_BAR_VIEWS,
  type TopBarDestination,
} from './topbar-destinations';

/**
 * Roles whose own keyboard handling owns Tab — a dialog's focus trap, a menu's
 * roving focus — so the bar leaves the key alone while focus sits inside one.
 */
const OVERLAY_ROLE_SELECTOR =
  '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"], [role="grid"]';

const isFocusInsideOverlay = () => {
  const focused = document.activeElement;
  return (
    focused instanceof Element &&
    focused.closest(OVERLAY_ROLE_SELECTOR) !== null
  );
};

/**
 * Act on press instead of release, so the bar responds the instant a button
 * goes down. The click handler still carries keyboard activation, which
 * reports `detail === 0` and never fires a preceding mousedown.
 */
function pressHandlers(run: (event: MouseEvent) => void) {
  return {
    onMouseDown: (event: MouseEvent) => {
      if (event.button !== 0) return;
      event.preventDefault();
      run(event);
    },
    onClick: (event: MouseEvent) => {
      if (event.detail !== 0) return;
      run(event);
    },
  };
}

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
  let searchInput: HTMLInputElement | undefined;

  /**
   * The focused split's own list search, which the bar drives in place of the
   * in-view search bar. Absent for splits that have no list to filter — a
   * document, say — where the field falls back to opening the command menu.
   */
  const viewSearch = createMemo(() => activeViewSearch());

  // Assign rather than bind: writing only on a real difference keeps the
  // caret still while typing, and still refills the field when the active
  // split (and so the search behind it) changes.
  createEffect(() => {
    const next = viewSearch()?.text() ?? '';
    if (searchInput && searchInput.value !== next) searchInput.value = next;
  });

  const searchHotkey = registerHotkey({
    hotkey: 'cmd+f',
    scopeId: 'global',
    description: 'Search this view',
    runWithInputFocused: true,
    condition: () => viewSearch() !== undefined,
    keyDownHandler: () => {
      searchInput?.focus();
      searchInput?.select();
      return true;
    },
  });
  onCleanup(searchHotkey.dispose);

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
  const openView = (
    destination: TopBarDestination,
    options?: { newSplit?: boolean; surface?: string }
  ) => {
    const newSplit = options?.newSplit ?? false;
    const surface = options?.surface ?? 'topbar';

    if (destination.id === 'brain' && !newSplit && !isActive(destination)) {
      analytics.track('sidebar_click', { surface, view: destination.id });
      navigate(buildBrainWorkspacePath(getLastBrainWorkspaceSelection()));
      globalSplitManager()?.returnFocus();
      return;
    }

    if (!newSplit && isActive(destination)) {
      globalSplitManager()?.returnFocus();
      return;
    }

    analytics.track('sidebar_click', { surface, view: destination.id });
    layout.openWithSplit(destination.content, {
      preferNewSplit: newSplit,
      mergeHistory: false,
      allowDuplicate: true,
      referredFrom: 'sidebar',
    });
    globalSplitManager()?.returnFocus();
  };

  /**
   * Step through the center views, wrapping at both ends. With no view
   * active — a document is open, say — forwards lands on the first and
   * backwards on the last.
   */
  const cycleViews = (step: 1 | -1) => {
    const views = visibleViews();
    if (views.length === 0) return false;

    const current = views.findIndex(isActive);
    const next =
      current === -1
        ? step === 1
          ? 0
          : views.length - 1
        : (current + step + views.length) % views.length;

    openView(views[next]!, { surface: 'topbar_hotkey' });
    return true;
  };

  /**
   * Tab owns view switching under this layout, so it must not swallow the
   * key where it still means "move focus": text fields opt out through
   * `runWithInputFocused`, and dialogs and menus keep their own traversal.
   * The soup views stand their own Tab binding down while the bar is up.
   */
  const cycleRegistrations = (
    [
      ['tab', 1, 'Next view'],
      ['shift+tab', -1, 'Previous view'],
    ] as const
  ).map(([hotkey, step, description]) =>
    registerHotkey({
      hotkey,
      scopeId: 'global',
      description,
      condition: () => visibleViews().length > 1 && !isFocusInsideOverlay(),
      keyDownHandler: () => cycleViews(step),
      icon: GridIcon,
      keywords: ['view', 'views', 'switch', 'cycle', 'top bar'],
    })
  );
  onCleanup(() => {
    for (const registration of cycleRegistrations) registration.dispose();
  });

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
            {...pressHandlers(() => navigate(DEFAULT_ROUTE))}
          >
            <LogoIcon class="size-6" />
          </button>
        </Tooltip>
        <SidebarCreateMenu
          isSlim={() => false}
          variant="pill"
          icon="plus"
          placement="bottom-start"
          onAgentSelect={() => navigate('/chat')}
        />
        <Show
          when={viewSearch()}
          fallback={
            <button
              type="button"
              class="flex h-10 w-60 min-w-0 shrink items-center gap-2 rounded-full bg-ink/5 px-3 text-left text-sm text-ink-muted outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
              {...pressHandlers(openSearch)}
            >
              <SearchIcon class="size-4 shrink-0" />
              <span class="truncate">Search Macro</span>
            </button>
          }
        >
          {(search) => (
            <div class="flex h-10 w-60 min-w-0 shrink items-center gap-2 rounded-full bg-ink/5 px-3 text-sm text-ink-muted transition-colors focus-within:bg-ink/8 focus-within:text-ink">
              <SearchIcon class="size-4 shrink-0" />
              <input
                ref={searchInput}
                type="text"
                aria-label={search().placeholder()}
                placeholder={search().placeholder()}
                class="min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-muted"
                onInput={(event) => search().setText(event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key !== 'Escape') return;
                  event.currentTarget.blur();
                }}
              />
              <Hotkey shortcut="cmd+f" theme="subtle" class="shrink-0" />
            </div>
          )}
        </Show>
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
                {...pressHandlers((event) =>
                  openView(destination, { newSplit: event.shiftKey })
                )}
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
                {...pressHandlers(() => openAsSplit(destination))}
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
            {...pressHandlers(() => openSettings('Account'))}
          >
            <GearIcon class="size-5" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
