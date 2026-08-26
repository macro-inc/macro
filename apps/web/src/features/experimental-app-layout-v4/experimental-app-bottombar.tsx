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
import { useSettingsState } from '@core/constant/SettingsState';
import LogoIcon from '@icon/macro-logo.svg';
import GridIcon from '@phosphor/dots-nine.svg';
import GearIcon from '@phosphor/gear.svg';
import SearchIcon from '@phosphor/magnifying-glass.svg';
import { useNavigate } from '@solidjs/router';
import { cn, Dropdown, Tooltip } from '@ui';
import type { Component, JSX, ParentProps } from 'solid-js';
import { createSignal, For, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

type DockIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/**
 * One floating group in the dock. Wears the menus' own glass surface so it
 * reads as the same kind of thing hovering over the page — `bg-surface` is the
 * page's own color and would disappear into it.
 */
function DockPill(props: ParentProps) {
  return (
    <div class="glass-lg pointer-events-auto flex items-center gap-0.5 rounded-full bg-(--color-menu-glass) p-1.5">
      {props.children}
    </div>
  );
}

/**
 * A round dock control. `active` is for the view the splits are showing: a
 * filled circle plus the icon's fill weight, since a floating pill has no edge
 * to underline against the way V3's top bar does.
 */
function DockButton(props: {
  label: string;
  /** Overrides the tooltip's label for screen readers (unread counts, say). */
  ariaLabel?: string;
  icon: DockIcon;
  activeIcon?: DockIcon;
  active?: boolean;
  /** Unread conversations behind this destination; 0 draws no badge. */
  unread?: number;
  onPress: (event: MouseEvent) => void;
}) {
  return (
    <Tooltip label={props.label} placement="top">
      <button
        type="button"
        aria-label={props.ariaLabel ?? props.label}
        aria-current={props.active ? 'page' : undefined}
        class={cn(
          'relative flex size-9 shrink-0 items-center justify-center rounded-full outline-none transition-colors focus-visible:ring-2 focus-visible:ring-accent/40',
          props.active
            ? 'bg-ink/10 text-ink'
            : 'text-ink-muted hover:bg-ink/5 hover:text-ink'
        )}
        {...pressHandlers(props.onPress)}
      >
        <Dynamic
          component={
            props.active ? (props.activeIcon ?? props.icon) : props.icon
          }
          class="size-5"
        />
        <Show when={(props.unread ?? 0) > 0}>
          <span
            class="absolute right-0.5 top-0.5 flex min-w-3.5 items-center justify-center rounded-full bg-accent px-1 text-[9px] font-semibold leading-[14px] text-surface"
            aria-hidden="true"
          >
            {unreadBadgeLabel(props.unread ?? 0)}
          </span>
        </Show>
      </button>
    </Tooltip>
  );
}

/**
 * V4's app chrome: Fey's floating dock in place of V3's top bar. The views ride
 * one glass pill hovering over the bottom of the splits and the things you do
 * next — open a companion split, create, search — ride a second beside it, so
 * the page runs edge to edge with no chrome welded to a side.
 *
 * The dock keeps V3's keyboard contract — digits jump to a view, Tab steps
 * through the row — and its badges, since both bars drive the same
 * destinations.
 */
export function ExperimentalAppBottomBar() {
  const navigation = createChromeNavigation('bottombar');
  const navigate = useNavigate();
  const { openSettings } = useSettingsState();
  const [appsOpen, setAppsOpen] = createSignal(false);
  const unreadCounts = createChromeUnreadCounts();
  const unreadCount = (destination: ChromeDestination) =>
    unreadCounts().get(destination.id) ?? 0;

  const viewHotkeys = registerChromeViewHotkeys({
    views: navigation.visibleViews,
    isActive: navigation.isActive,
    openView: (destination) =>
      navigation.openView(destination, { surface: 'bottombar_hotkey' }),
  });
  onCleanup(() => {
    for (const registration of viewHotkeys) registration.dispose();
  });

  const openInNewTab = (destination: ChromeDestination) => {
    setAppsOpen(false);
    navigation.openInNewTab(destination);
  };

  return (
    // The row is the lane the splits reserve (`--app-dock-lane`), and it only
    // takes presses where a pill actually is.
    <div
      class="pointer-events-none fixed inset-x-0 bottom-0 z-float flex justify-center gap-2 pb-3"
      style={{ height: 'var(--app-dock-lane)' }}
    >
      <DockPill>
        <Tooltip label="Home" placement="top">
          <button
            type="button"
            aria-label="Home"
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-accent outline-none transition-colors hover:bg-ink/8 focus-visible:ring-2 focus-visible:ring-accent/40"
            {...pressHandlers(() => navigate(DEFAULT_ROUTE))}
          >
            <LogoIcon class="size-5" />
          </button>
        </Tooltip>
        <span class="mx-1 h-5 w-px shrink-0 bg-edge-muted" aria-hidden="true" />
        <nav aria-label="App views" class="flex items-center gap-0.5">
          <For each={navigation.visibleViews()}>
            {(destination) => (
              <DockButton
                label={destination.label}
                ariaLabel={
                  unreadCount(destination) > 0
                    ? `${destination.label}, ${unreadCount(destination)} unread`
                    : destination.label
                }
                icon={destination.icon}
                activeIcon={destination.filledIcon}
                active={navigation.isActive(destination)}
                unread={unreadCount(destination)}
                onPress={(event) =>
                  navigation.openView(destination, { newSplit: event.shiftKey })
                }
              />
            )}
          </For>
        </nav>
      </DockPill>

      {/* Create, search and the companion splits ride outside the row of
          views, the way Fey detaches its search: the row is where you are,
          these are what you do next. */}
      <DockPill>
        <For each={CHROME_SPLIT_DESTINATIONS}>
          {(destination) => (
            <DockButton
              label={`Open ${destination.label} in a split`}
              icon={destination.icon}
              onPress={() => navigation.openAsSplit(destination)}
            />
          )}
        </For>
        <Dropdown open={appsOpen()} onOpenChange={setAppsOpen} placement="top">
          <Tooltip label="Macro apps" placement="top">
            <Dropdown.Trigger
              size="icon-md"
              variant="ghost"
              class="!size-9 shrink-0 rounded-full px-0 text-ink-muted"
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
        <DockButton
          label="Settings"
          icon={GearIcon}
          onPress={() => openSettings('Account')}
        />
        <span class="mx-1 h-5 w-px shrink-0 bg-edge-muted" aria-hidden="true" />
        <SidebarCreateMenu
          isSlim={() => true}
          variant="icon"
          icon="plus"
          placement="top-end"
          onAgentSelect={() => navigate('/chat')}
        />
        <Tooltip label="Search Macro" shortcut="cmd+k" placement="top">
          <button
            type="button"
            aria-label="Search Macro"
            class="flex size-9 shrink-0 items-center justify-center rounded-full text-ink-muted outline-none transition-colors hover:bg-ink/5 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
            {...pressHandlers(navigation.openSearch)}
          >
            <SearchIcon class="size-5" />
          </button>
        </Tooltip>
      </DockPill>
    </div>
  );
}
