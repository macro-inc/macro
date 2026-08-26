import { DEFAULT_ROUTE } from '@app/constants/defaultRoute';
import type { ChromeDestination } from '@app/features/app-layout/chrome/chrome-destinations';
import {
  createAfterPaintRunner,
  createChromeNavigation,
  pressHandlers,
} from '@app/features/app-layout/chrome/chrome-navigation';
import {
  createChromeUnreadCounts,
  unreadBadgeLabel,
} from '@app/features/app-layout/chrome/chrome-unread';
import { registerChromeViewHotkeys } from '@app/features/app-layout/chrome/chrome-view-hotkeys';
import { SidebarCreateMenu } from '@app/features/command/sidebar/sidebar-create-menu';
import { globalSplitManager } from '@app/signal/splitLayout';
import { EntityIcon } from '@core/component/EntityIcon';
import LogoIcon from '@icon/macro-logo.svg';
import CloseIcon from '@phosphor/x.svg';
import { useNavigate } from '@solidjs/router';
import { cn, Tooltip } from '@ui';
import type { Component, JSX, ParentProps } from 'solid-js';
import { createEffect, createSignal, For, onCleanup, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import {
  createCurrentDockWindow,
  type DockWindow,
  dockWindows,
  forgetDockWindow,
  rememberDockWindow,
} from './dock-windows';

type DockIcon = Component<JSX.SvgSVGAttributes<SVGSVGElement>>;

/**
 * How long an arrangement has to hold still before the dock records it: long
 * enough to cover a load mounting its splits one by one, short enough that
 * opening something reads as landing in the dock with it.
 */
const WINDOW_SETTLE_MS = 250;

/**
 * One floating group in the dock. Wears the menus' own glass surface so it
 * reads as the same kind of thing hovering over the page — `bg-surface` is the
 * page's own color and would disappear into it.
 */
function DockPill(props: ParentProps<{ class?: string }>) {
  return (
    <div
      class={cn(
        'glass-lg pointer-events-auto flex items-center gap-0.5 rounded-full bg-(--color-menu-glass) p-1.5',
        props.class
      )}
    >
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
 * One open window: an entity, or a split arrangement, that the views row has
 * no button for. Only the one you are looking at spells itself out; the rest
 * collapse to their icon and answer a hover with their name, so a row of them
 * costs the dock about as much room as a view button each.
 */
function DockWindowTab(props: {
  window: DockWindow;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  const titles = () => props.window.titles.filter(Boolean);
  const title = () => titles()[0] ?? 'Untitled';
  /** A window holding several splits names them all rather than just the first. */
  const label = () => titles().join('  ·  ') || 'Untitled';
  const extraSplits = () => titles().length - 1;

  return (
    <Tooltip label={label()} placement="top" as="div" class="shrink-0">
      {/* The icon keeps the same inset in both states — collapsed, the pill is
          exactly a view button's 36px around it; open, only the right side
          gives way to the name. Sizing it by padding rather than by width is
          what lets the two states animate into each other. */}
      <div
        class={cn(
          'flex h-9 items-center rounded-full pl-2.5 transition-all duration-200',
          props.active
            ? 'bg-ink/10 pr-1 text-ink'
            : 'pr-2.5 text-ink-muted hover:bg-ink/5 hover:text-ink'
        )}
      >
        <button
          type="button"
          aria-label={props.active ? label() : `Open ${label()}`}
          aria-current={props.active ? 'page' : undefined}
          class="flex h-9 min-w-0 items-center rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          {...pressHandlers(props.onOpen)}
          // Middle-click closes it, the way it closes a browser tab: the ×
          // only rides the open window, so this is how the rest go away.
          onAuxClick={(event) => {
            if (event.button !== 1) return;
            event.preventDefault();
            props.onClose();
          }}
        >
          <EntityIcon
            class="shrink-0"
            targetType={props.window.iconType}
            size="xs"
            theme="monochrome"
          />
          {/* Always mounted, and one fixed width whatever the name is: the
              dock is centered, so a label sized to its text would shift the
              whole row every time you moved between windows. */}
          <span
            class={cn(
              'truncate text-start text-xs transition-all duration-200',
              props.active ? 'w-32 pl-2' : 'w-0 opacity-0'
            )}
          >
            {title()}
          </span>
          <Show when={props.active && extraSplits() > 0}>
            <span class="ml-1.5 shrink-0 rounded-full bg-ink/10 px-1.5 text-[10px] leading-4">
              +{extraSplits()}
            </span>
          </Show>
        </button>
        <Show when={props.active}>
          <button
            type="button"
            aria-label={`Close ${label()}`}
            class="flex size-7 shrink-0 items-center justify-center rounded-full text-ink-muted outline-none transition-colors hover:bg-ink/10 hover:text-ink focus-visible:ring-2 focus-visible:ring-accent/40"
            {...pressHandlers(props.onClose)}
          >
            <CloseIcon class="size-3" />
          </button>
        </Show>
      </div>
    </Tooltip>
  );
}

/**
 * V4's app chrome: Fey's floating dock in place of V3's top bar. The views ride
 * one glass pill hovering over the bottom of the splits and the things you do
 * next — open a companion split, create, search — ride a second beside it, so
 * the page runs edge to edge with no chrome welded to a side. Whatever is open
 * that is neither of those — an entity, a pair of splits — rides a pill of its
 * own between them.
 *
 * The dock keeps V3's keyboard contract — digits jump to a view, Tab steps
 * through the row — and its badges, since both bars drive the same
 * destinations.
 */
export function ExperimentalAppBottomBar() {
  const navigation = createChromeNavigation({
    surface: 'bottombar',
    // The dock's row is places, not panes: a view never swaps itself into a
    // split you opened, it just takes you to that page.
    views: 'page',
  });
  const navigate = useNavigate();
  const unreadCounts = createChromeUnreadCounts();
  const unreadCount = (destination: ChromeDestination) =>
    unreadCounts().get(destination.id) ?? 0;

  const currentWindow = createCurrentDockWindow();
  const navigateAfterPaint = createAfterPaintRunner();

  /**
   * The window a press committed to, until the splits get there. Restoring an
   * arrangement remounts every split in it, which is far too slow to leave the
   * pressed tab looking unpressed.
   */
  const [pendingWindowKey, setPendingWindowKey] = createSignal<string>();
  const activeWindowKey = () => pendingWindowKey() ?? currentWindow()?.key;

  createEffect(() => {
    if (currentWindow()?.key === pendingWindowKey()) {
      setPendingWindowKey(undefined);
    }
  });

  // Anything that isn't one of the bar's own destinations earns a place in the
  // dock as it opens, and keeps it after you navigate away. Two guards keep
  // the half-built states out: nothing is recorded while a restore is still
  // mounting its splits (its window is already in the dock), and otherwise an
  // arrangement has to hold still first, since a cold load mounts its splits
  // one at a time and would otherwise leave a tab behind for the first alone.
  createEffect(() => {
    const open = currentWindow();
    if (!open || pendingWindowKey() !== undefined) return;
    const settle = setTimeout(() => rememberDockWindow(open), WINDOW_SETTLE_MS);
    onCleanup(() => clearTimeout(settle));
  });

  const openWindow = (window: DockWindow) => {
    if (activeWindowKey() === window.key) {
      globalSplitManager()?.returnFocus();
      return;
    }

    setPendingWindowKey(window.key);
    navigateAfterPaint(() => navigate(window.path));
  };

  /**
   * Closing the window you are looking at has to move you off it, or the
   * splits would put it straight back.
   */
  const closeWindow = (window: DockWindow) => {
    const leaving = activeWindowKey() === window.key;
    forgetDockWindow(window.key);
    if (leaving) navigate(DEFAULT_ROUTE);
  };

  const viewHotkeys = registerChromeViewHotkeys({
    views: navigation.visibleViews,
    isActive: navigation.isActive,
    openView: (destination) =>
      navigation.openView(destination, { surface: 'bottombar_hotkey' }),
  });
  onCleanup(() => {
    for (const registration of viewHotkeys) registration.dispose();
  });

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

      <Show when={dockWindows().length > 0}>
        <DockPill>
          <For each={dockWindows()}>
            {(window) => (
              <DockWindowTab
                window={window}
                active={activeWindowKey() === window.key}
                onOpen={() => openWindow(window)}
                onClose={() => closeWindow(window)}
              />
            )}
          </For>
        </DockPill>
      </Show>

      {/* Create rides outside the row of views: the row is where you are,
          this is what you make next. Alone in its island it is the island —
          one round button carrying the glass itself, rather than a smaller
          button sitting inside a circle of it. */}
      <DockPill class="p-0">
        <SidebarCreateMenu
          isSlim={() => true}
          variant="icon"
          icon="plus"
          placement="top-end"
          class="size-12 border-transparent bg-transparent text-ink-muted shadow-none hover:bg-ink/5 hover:text-ink! [&_svg]:size-5!"
          onAgentSelect={() => navigate('/chat')}
        />
      </DockPill>
    </div>
  );
}
