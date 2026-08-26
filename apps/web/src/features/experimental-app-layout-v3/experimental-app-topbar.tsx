import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import type { ChromeDestination } from '@app/features/app-layout/chrome/chrome-destinations';
import { CHROME_SPLIT_DESTINATIONS } from '@app/features/app-layout/chrome/chrome-destinations';
import {
  createChromeNavigation,
  pressHandlers,
} from '@app/features/app-layout/chrome/chrome-navigation';
import {
  createChromeUnreadCounts,
  unreadBadgeLabel,
} from '@app/features/app-layout/chrome/chrome-unread';
import { registerChromeViewHotkeys } from '@app/features/app-layout/chrome/chrome-view-hotkeys';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { activeViewSearch } from '@app/features/next-soup/soup-view/active-view-search';
import { useSettingsState } from '@core/constant/SettingsState';
import { registerHotkey } from '@core/hotkey/hotkeys';
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

/**
 * V3's app chrome: a 56px top bar in place of the V2 sidebar. Logo and search
 * sit at the left, the primary views run down the middle with Facebook's
 * filled-icon-plus-underline active state, and the right cluster opens the
 * companion splits and the sub-app grid.
 */
export function ExperimentalAppTopBar() {
  const navigation = createChromeNavigation('topbar');
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();
  const [appsOpen, setAppsOpen] = createSignal(false);
  const unreadCounts = createChromeUnreadCounts();
  const unreadCount = (destination: ChromeDestination) =>
    unreadCounts().get(destination.id) ?? 0;
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

  const isActive = navigation.isActive;
  const openView = navigation.openView;
  const visibleViews = navigation.visibleViews;

  const viewHotkeys = registerChromeViewHotkeys({
    views: visibleViews,
    isActive,
    openView: (destination) =>
      openView(destination, { surface: 'topbar_hotkey' }),
  });
  onCleanup(() => {
    for (const registration of viewHotkeys) registration.dispose();
  });

  const openInNewTab = (destination: ChromeDestination) => {
    setAppsOpen(false);
    navigation.openInNewTab(destination);
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
          isSlim={() => true}
          variant="icon"
          icon="plus"
          placement="bottom-start"
          filled
          large
          onAgentSelect={() => navigate('/chat')}
        />
        <Show
          when={viewSearch()}
          fallback={
            <button
              type="button"
              class="flex h-10 w-60 min-w-0 shrink items-center gap-2 rounded-full bg-ink/5 px-3 text-left text-sm text-ink-muted outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
              {...pressHandlers(navigation.openSearch)}
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
                aria-label={
                  unreadCount(destination) > 0
                    ? `${destination.label}, ${unreadCount(destination)} unread`
                    : destination.label
                }
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
                  {/* Wraps the glyph rather than the button so the badge sits
                      on the icon's corner, not the row's. */}
                  <span class="relative flex items-center justify-center">
                    <Dynamic
                      component={
                        isActive(destination)
                          ? destination.filledIcon
                          : destination.icon
                      }
                      class="size-6"
                    />
                    <Show when={unreadCount(destination) > 0}>
                      <span
                        class="absolute -right-2.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-4 text-surface"
                        aria-hidden="true"
                      >
                        {unreadBadgeLabel(unreadCount(destination))}
                      </span>
                    </Show>
                  </span>
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
        <For each={CHROME_SPLIT_DESTINATIONS}>
          {(destination) => (
            <Tooltip label={`Open ${destination.label} in a split`}>
              <button
                type="button"
                aria-label={`Open ${destination.label} in a split`}
                class={cn(
                  'glass flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/5 outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40',
                  isActive(destination) ? 'text-accent' : 'text-ink'
                )}
                {...pressHandlers(() => navigation.openAsSplit(destination))}
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
            {/* icon-md so the Button picks the medium glass its neighbors wear */}
            <Dropdown.Trigger
              size="icon-md"
              class="!size-10 shrink-0 rounded-full bg-ink/5 px-0"
              aria-label="Macro apps"
            >
              <GridIcon class="size-5" />
            </Dropdown.Trigger>
          </Tooltip>
          <Dropdown.Content class="w-72">
            <Dropdown.Group class="grid grid-cols-3 gap-1 p-2">
              <For each={navigation.visibleSubApps()}>
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
            class="glass flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
            {...pressHandlers(() => openSettings('Account'))}
          >
            <GearIcon class="size-5" />
          </button>
        </Tooltip>
      </div>
    </header>
  );
}
