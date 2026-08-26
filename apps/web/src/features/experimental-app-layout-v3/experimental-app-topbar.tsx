import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { useSettingsState } from '@core/constant/SettingsState';
import LogoIcon from '@icon/macro-logo.svg';
import GridIcon from '@phosphor/dots-nine.svg';
import GearIcon from '@phosphor/gear.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { useNavigate } from '@solidjs/router';
import { cn, Dropdown, Hotkey, Tooltip } from '@ui';
import { createSignal, For, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import { TOP_BAR_SPLIT_DESTINATIONS } from './topbar-destinations';
import { unreadBadgeLabel } from './topbar-unread';
import {
  createViewChromeController,
  pressHandlers,
} from './view-chrome-controller';

/**
 * V3's app chrome: a 56px top bar in place of the V2 sidebar. Logo and search
 * sit at the left, the primary views run down the middle with Facebook's
 * filled-icon-plus-underline active state, and the right cluster opens the
 * companion splits and the sub-app grid.
 */
export function ExperimentalAppTopBar() {
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();
  const [appsOpen, setAppsOpen] = createSignal(false);
  const chrome = createViewChromeController({ surface: 'topbar' });

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
          when={chrome.viewSearch()}
          fallback={
            <button
              type="button"
              class="flex h-10 w-60 min-w-0 shrink items-center gap-2 rounded-full bg-ink/5 px-3 text-left text-sm text-ink-muted outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
              {...pressHandlers(chrome.openSearch)}
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
                ref={chrome.registerSearchInput}
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
        <For each={chrome.visibleViews()}>
          {(destination) => (
            <Tooltip label={destination.label}>
              <button
                type="button"
                aria-label={
                  chrome.unreadCount(destination) > 0
                    ? `${destination.label}, ${chrome.unreadCount(destination)} unread`
                    : destination.label
                }
                aria-current={chrome.isActive(destination) ? 'page' : undefined}
                class={cn(
                  'group/top-bar-view relative flex h-full w-[76px] items-center justify-center px-1 outline-none',
                  chrome.isActive(destination)
                    ? 'text-accent'
                    : 'text-ink-muted'
                )}
                {...pressHandlers((event) =>
                  chrome.openView(destination, { newSplit: event.shiftKey })
                )}
              >
                <span
                  class={cn(
                    'flex h-10 w-full items-center justify-center rounded-lg transition-colors',
                    !chrome.isActive(destination) &&
                      'group-hover/top-bar-view:bg-ink/5 group-hover/top-bar-view:text-ink',
                    'group-focus-visible/top-bar-view:ring-2 group-focus-visible/top-bar-view:ring-accent/40'
                  )}
                >
                  {/* Wraps the glyph rather than the button so the badge sits
                      on the icon's corner, not the row's. */}
                  <span class="relative flex items-center justify-center">
                    <Dynamic
                      component={
                        chrome.isActive(destination)
                          ? destination.filledIcon
                          : destination.icon
                      }
                      class="size-6"
                    />
                    <Show when={chrome.unreadCount(destination) > 0}>
                      <span
                        class="absolute -right-2.5 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-4 text-surface"
                        aria-hidden="true"
                      >
                        {unreadBadgeLabel(chrome.unreadCount(destination))}
                      </span>
                    </Show>
                  </span>
                </span>
                <Show when={chrome.isActive(destination)}>
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
                  'glass flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/5 outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40',
                  chrome.isActive(destination) ? 'text-accent' : 'text-ink'
                )}
                {...pressHandlers(() => chrome.openAsSplit(destination))}
              >
                <Dynamic
                  component={
                    chrome.isActive(destination)
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
              <For each={chrome.visibleSubApps()}>
                {(destination) => (
                  <Dropdown.Item
                    class="flex h-auto flex-col items-center gap-1.5 rounded-lg px-1 py-3 text-center"
                    onSelect={() => {
                      setAppsOpen(false);
                      chrome.openInNewTab(destination);
                    }}
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
