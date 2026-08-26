import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { TOP_BAR_SPLIT_DESTINATIONS } from '@app/features/experimental-app-layout-v3/topbar-destinations';
import { unreadBadgeLabel } from '@app/features/experimental-app-layout-v3/topbar-unread';
import {
  createViewChromeController,
  pressHandlers,
} from '@app/features/experimental-app-layout-v3/view-chrome-controller';
import type { SidebarState } from '@components/app/app-sidebar/sidebar';
import { useSettingsState } from '@core/constant/SettingsState';
import { registerHotkey } from '@core/hotkey/hotkeys';
import { TOKENS } from '@core/hotkey/tokens';
import LogoIcon from '@icon/macro-logo.svg';
import GridIcon from '@phosphor/dots-nine.svg';
import GearIcon from '@phosphor/gear.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { useNavigate } from '@solidjs/router';
import { cn, Dropdown, Hotkey, Tooltip } from '@ui';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

const SIDEBAR_TRANSITION =
  'max-width ease-in-out 140ms, width ease-in-out 140ms';

type ExperimentalAppSidebarProps = {
  sidebarState?: SidebarState;
  onOpenChange: (open: boolean) => void;
  overlayOpen?: boolean;
  onOverlayOpenChange?: (open: boolean) => void;
};

/**
 * V4's app chrome: V3's top bar stood on its left edge. Logo, create and the
 * live search sit at the top, the primary views run down the middle with the
 * filled-icon active state and an accent bar on the row's left edge (the
 * underline, rotated), and the bottom cluster opens the companion splits and
 * the sub-app grid. All behavior — optimistic active state, paint-deferred
 * navigation, unread badges, Tab/digit hotkeys — is the shared controller's.
 */
export function ExperimentalAppSidebar(props: ExperimentalAppSidebarProps) {
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();
  const [appsOpen, setAppsOpen] = createSignal(false);
  const chrome = createViewChromeController({ surface: 'sidebar_v4' });

  const isSlim = () => props.sidebarState === 'slim';

  const toggleRegistration = registerHotkey({
    hotkey: 'cmd+.',
    scopeId: 'global',
    hotkeyToken: TOKENS.global.toggleSidebar,
    description: 'Toggle sidebar',
    runWithInputFocused: true,
    keyDownHandler: (event) => {
      event?.preventDefault();
      props.onOpenChange(isSlim());
      return true;
    },
  });
  onCleanup(toggleRegistration.dispose);

  return (
    <aside
      aria-label="App navigation"
      class={cn(
        'relative flex h-full shrink-0 flex-col gap-2 overflow-hidden border-r border-edge-muted bg-surface pb-3 pt-2',
        isSlim() ? 'w-16 px-2' : 'w-60 px-3',
        props.sidebarState === 'hidden' &&
          'w-0 max-w-0 border-r-0 p-0 opacity-0'
      )}
      style={{ transition: SIDEBAR_TRANSITION }}
    >
      <div
        class={cn(
          'flex shrink-0 items-center gap-2',
          isSlim() && 'flex-col justify-center'
        )}
      >
        <Tooltip label="Home" placement="right" disabled={!isSlim()}>
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
          isSlim={isSlim}
          variant="icon"
          icon="plus"
          placement={isSlim() ? 'right-start' : 'bottom-start'}
          filled
          large
          onAgentSelect={() => navigate('/chat')}
        />
      </div>

      <Show
        when={!isSlim() && chrome.viewSearch()}
        fallback={
          <Tooltip label="Search Macro" placement="right" disabled={!isSlim()}>
            <button
              type="button"
              aria-label="Search Macro"
              class={cn(
                'flex h-10 shrink-0 items-center gap-2 rounded-full bg-ink/5 text-sm text-ink-muted outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40',
                isSlim() ? 'w-full justify-center' : 'px-3 text-left'
              )}
              {...pressHandlers(chrome.openSearch)}
            >
              <SearchIcon class="size-4 shrink-0" />
              <Show when={!isSlim()}>
                <span class="truncate">Search Macro</span>
              </Show>
            </button>
          </Tooltip>
        }
      >
        {(search) => (
          <div class="flex h-10 shrink-0 items-center gap-2 rounded-full bg-ink/5 px-3 text-sm text-ink-muted transition-colors focus-within:bg-ink/8 focus-within:text-ink">
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

      <nav aria-label="App views" class="mt-1 min-h-0 flex-1 overflow-y-auto">
        <ul class="flex flex-col gap-1">
          <For each={chrome.visibleViews()}>
            {(destination) => (
              <li>
                <Tooltip
                  label={destination.label}
                  placement="right"
                  class="w-full"
                  disabled={!isSlim()}
                >
                  <button
                    type="button"
                    aria-label={
                      chrome.unreadCount(destination) > 0
                        ? `${destination.label}, ${chrome.unreadCount(destination)} unread`
                        : destination.label
                    }
                    aria-current={
                      chrome.isActive(destination) ? 'page' : undefined
                    }
                    class={cn(
                      'group/side-view relative flex h-10 w-full items-center rounded-lg font-medium outline-none transition-colors',
                      isSlim() ? 'justify-center' : 'gap-3 px-3 text-left',
                      chrome.isActive(destination)
                        ? 'text-accent'
                        : 'text-ink-muted hover:bg-ink/5 hover:text-ink',
                      'focus-visible:ring-2 focus-visible:ring-accent/40'
                    )}
                    {...pressHandlers((event) =>
                      chrome.openView(destination, {
                        newSplit: event.shiftKey,
                      })
                    )}
                  >
                    {/* The top bar's underline, rotated onto the row's left
                        edge. */}
                    <Show when={chrome.isActive(destination)}>
                      <span class="pointer-events-none absolute inset-y-2 left-0 w-[3px] rounded-r-sm bg-accent" />
                    </Show>
                    <span class="relative flex size-6 shrink-0 items-center justify-center">
                      <Dynamic
                        component={
                          chrome.isActive(destination)
                            ? destination.filledIcon
                            : destination.icon
                        }
                        class="size-6"
                      />
                      <Show
                        when={isSlim() && chrome.unreadCount(destination) > 0}
                      >
                        <span
                          class="absolute -right-2 -top-1.5 flex min-w-4 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-4 text-surface"
                          aria-hidden="true"
                        >
                          {unreadBadgeLabel(chrome.unreadCount(destination))}
                        </span>
                      </Show>
                    </span>
                    <Show when={!isSlim()}>
                      <span class="min-w-0 flex-1 truncate">
                        {destination.label}
                      </span>
                      <Show when={chrome.unreadCount(destination) > 0}>
                        <span
                          class="flex min-w-4 shrink-0 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-4 text-surface"
                          aria-hidden="true"
                        >
                          {unreadBadgeLabel(chrome.unreadCount(destination))}
                        </span>
                      </Show>
                    </Show>
                  </button>
                </Tooltip>
              </li>
            )}
          </For>
        </ul>
      </nav>

      <footer
        class={cn(
          'flex shrink-0 items-center gap-1.5 border-t border-edge-muted/70 pt-3',
          isSlim() ? 'flex-col' : 'justify-between'
        )}
      >
        <For each={TOP_BAR_SPLIT_DESTINATIONS}>
          {(destination) => (
            <Tooltip
              label={`Open ${destination.label} in a split`}
              placement={isSlim() ? 'right' : 'top'}
            >
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
          placement={isSlim() ? 'right-end' : 'top-start'}
        >
          <Tooltip label="Macro apps" placement={isSlim() ? 'right' : 'top'}>
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
        <Tooltip label="Settings" placement={isSlim() ? 'right' : 'top'}>
          <button
            type="button"
            aria-label="Settings"
            class="glass flex size-10 shrink-0 items-center justify-center rounded-full bg-ink/5 text-ink outline-none transition-colors hover:bg-ink/10 focus-visible:ring-2 focus-visible:ring-accent/40"
            {...pressHandlers(() => openSettings('Account'))}
          >
            <GearIcon class="size-5" />
          </button>
        </Tooltip>
      </footer>
    </aside>
  );
}
