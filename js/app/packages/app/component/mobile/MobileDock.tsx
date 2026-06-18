import './MobileDock.css';
import { isListViewID, type ListView } from '@app/constants/list-views';
import { globalSplitManager } from '@app/signal/splitLayout';
import { useSettingsState } from '@core/constant/SettingsState';
import { triggerFocusInput } from '@core/directive/focusInput';
import { hapticImpact } from '@core/mobile/haptics';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { ICON_ANIMATION_DURATION_MS } from '@icon/animation';
import IconGear from '@icon/macro-gear.svg';
import { AnimatedCallIcon } from '@icon/wide-call';
import { AnimatedChannelIcon } from '@icon/wide-channel';
import { AnimatedEmailIcon } from '@icon/wide-email';
import { AnimatedFileMdIcon } from '@icon/wide-fileMd';
import { AnimatedFolderIcon } from '@icon/wide-folder';
import { AnimatedInboxIcon } from '@icon/wide-inbox';
import { AnimatedSearchIcon } from '@icon/wide-search';
import { AnimatedStarIcon } from '@icon/wide-star';
import { AnimatedTaskIcon } from '@icon/wide-task';
import CaretUpIcon from '@phosphor/caret-up.svg';
import HomeIcon from '@phosphor/house.svg';
import PlusIcon from '@phosphor/plus.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { useLocation } from '@solidjs/router';
import { cn, Layer } from '@ui';
import { type Component, createSignal, For, type JSX, Show } from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { setCreateMenuOpen } from '../Launcher';
import { useSplitLayout } from '../split-layout/layout';
import { SearchState } from './mobileSearchState';
import { pressPulse } from './pressPulse';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

type DockId = ListView | 'home';

type IconComponent = Component<
  JSX.SvgSVGAttributes<SVGSVGElement> | { triggerAnimation?: boolean }
>;

type MobileDockButtonProps = {
  icon: IconComponent;
  label?: string;
  /** Accessible name for icon-only buttons (falls back to `label`). */
  ariaLabel?: string;
  onClick: () => void;
  active?: boolean;
  ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
  onTouchMove?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
  iconClass?: string;
  class?: string;
  /** Plain svg icons (Home, Caret) don't accept `triggerAnimation`. */
  animateIcon?: boolean;
  /** Fire on pointer-down instead of release. (More menu: opening on press
   * enables the hold-and-drag row selection gesture.) */
  fireOnPress?: boolean;
};

function MobileDockButton(props: MobileDockButtonProps) {
  const [animating, setAnimating] = createSignal(false);

  return (
    <button
      type="button"
      ref={props.ref}
      aria-label={props.ariaLabel ?? props.label}
      use:pressPulse
      onPointerDown={() => {
        hapticImpact('light');
        if (props.animateIcon !== false) {
          setAnimating(true);
          setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        }
        if (props.fireOnPress) props.onClick();
      }}
      // Default: fires on release — the press pulse holds the on-state while
      // touched. (Not on fireOnPress buttons, which already fired above.)
      onClick={() => {
        if (!props.fireOnPress) props.onClick();
      }}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn(
        'island pointer-events-auto flex items-center justify-center',
        props.active && 'text-accent',
        props.class
      )}
    >
      <div class={cn('size-6 [&_svg]:size-6', props.iconClass)}>
        {props.animateIcon === false ? (
          <Dynamic component={props.icon} />
        ) : (
          <Dynamic component={props.icon} triggerAnimation={animating()} />
        )}
      </div>
      <Show when={props.label}>
        <span class="text-sm font-medium">{props.label}</span>
      </Show>
    </button>
  );
}

const MORE_VIEWS: { id: ListView; label: string; icon: IconComponent }[] = [
  { id: 'agents', label: 'Agents', icon: AnimatedStarIcon },
  { id: 'mail', label: 'Email', icon: AnimatedEmailIcon },
  { id: 'documents', label: 'Documents', icon: AnimatedFileMdIcon },
  { id: 'tasks', label: 'Tasks', icon: AnimatedTaskIcon },
  { id: 'channels', label: 'Channels', icon: AnimatedChannelIcon },
  { id: 'calls', label: 'Calls', icon: AnimatedCallIcon },
  { id: 'folders', label: 'Folders', icon: AnimatedFolderIcon },
];

// The More button opens the menu on pointer-down (see fireOnPress), which also
// arms the hold-and-drag-to-select gesture. The opening touch lifts after the
// overlay is up, and its trailing synthesized click would land on whatever is
// now under the finger: a freshly-mounted menu item (accidental selection) or,
// once a drag-release dismisses the menu, the adjacent Create button. Swallow
// that one click (capture phase, one-shot) so the opening touch can't leak
// through. The timeout clears the listener if no ghost click arrives.
function suppressNextClick() {
  const onClick = (e: MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    cleanup();
  };
  const cleanup = () => {
    document.removeEventListener('click', onClick, true);
    clearTimeout(timer);
  };
  const timer = setTimeout(cleanup, 400);
  document.addEventListener('click', onClick, true);
}

function MorePopover(props: {
  isActive: (id: DockId) => boolean;
  onNavigate: (id: DockId) => void;
}) {
  const { settingsOpen, toggleSettings } = useSettingsState();
  // `open` drives the show/hide animation (via data-expanded); `mounted`
  // keeps the overlay in the DOM until the hide animation finishes.
  const [open, setOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  // The menu's natural size, fed to the open/close animation as CSS vars —
  // the container animates its real width/height between the dock button's
  // size and these (see MobileDock.css).
  const [menuRef, setMenuRef] = createSignal<HTMLDivElement>();
  const menuSize = createElementSize(menuRef);

  const openMenu = () => {
    setMounted(true);
    setOpen(true);
    // Block the opening touch's trailing click (see suppressNextClick).
    suppressNextClick();
  };

  const closeMenu = () => {
    setOpen(false);
    setHoveredId(null);
  };

  // Row selection: unmount instantly, no hide animation. The size animation
  // is layout-bound and would drop frames while navigation mounts the
  // destination view; the animated close is kept for plain dismissals
  // (backdrop, caret, More button), where the main thread is idle.
  const dismissMenu = () => {
    setOpen(false);
    setMounted(false);
    setHoveredId(null);
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!open()) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const button = el?.closest('[data-more-item]') as HTMLElement | null;
    const id = button?.dataset.moreItem ?? null;
    if (id !== hoveredId()) {
      setHoveredId(id);
      if (id) hapticImpact('light');
    }
  };

  // Acts on a row by id. 'settings' toggles the settings panel; list-view ids
  // navigate. Shared by tap (onClick) and the hold-and-drag-release gesture.
  const select = (id: string | null) => {
    if (id === 'settings') {
      toggleSettings();
    } else if (isListViewID(id)) {
      props.onNavigate(id);
    } else {
      return;
    }
    dismissMenu();
  };

  const handleTouchEnd = () => {
    const id = hoveredId();
    setHoveredId(null);
    select(id);
  };

  return (
    <>
      <MobileDockButton
        icon={CaretUpIcon}
        ariaLabel="More views"
        animateIcon={false}
        fireOnPress
        onClick={() => (open() ? closeMenu() : openMenu())}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
        class="size-10 rounded-full"
      />
      <Show when={mounted()}>
        <Portal>
          {/* Portaled to <body>, outside FloatRegionHost's Layer — re-apply
              depth 3 so the menu's surface matches the rest of the dock. */}
          <Layer depth={3}>
            {/* Backdrop: any tap outside the menu closes it. The bottom
              padding mirrors FloatRegionHost's, so the menu's bottom edge
              aligns with the bottom of the dock. */}
            <div
              class={cn(
                'fixed inset-0 z-modal flex items-end justify-center pb-3',
                isNativeMobilePlatform() && 'pb-7'
              )}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) closeMenu();
              }}
            >
              {/* The container is what the open/close animation sizes; it
                expands upward from the dock line. The inner menu keeps its
                full size, pinned to the container's left edge (so it rides
                leftward as the box widens from center) and to its bottom
                edge (so it stays put vertically and is unmasked top-down as
                the box grows upward). */}
              <div
                class="more-popover-content flex items-end justify-start overflow-hidden rounded-2xl bg-surface ring ring-edge"
                data-expanded={open() ? '' : undefined}
                style={{
                  '--more-popover-width': menuSize.width
                    ? `${menuSize.width}px`
                    : undefined,
                  '--more-popover-height': menuSize.height
                    ? `${menuSize.height}px`
                    : undefined,
                }}
                onAnimationEnd={(e) => {
                  // Icon animations bubble animationend; only unmount when the
                  // container's own hide animation completes.
                  if (e.target === e.currentTarget && !open())
                    setMounted(false);
                }}
              >
                {/* Width matches the dock: full screen minus its gutters. */}
                <div
                  class="flex w-[calc(100vw-2*var(--mobile-chrome-gutter))] shrink-0 flex-col gap-1 p-1"
                  ref={setMenuRef}
                >
                  <button
                    type="button"
                    data-more-item="settings"
                    class={cn(
                      'flex h-11 items-center gap-2 rounded-lg px-3 text-sm',
                      settingsOpen() ? 'text-accent' : 'text-ink',
                      hoveredId() === 'settings' ? 'bg-hover' : 'hover:bg-hover'
                    )}
                    onClick={() => {
                      hapticImpact('light');
                      select('settings');
                    }}
                  >
                    <div class="size-4 shrink-0 [&_svg]:size-4">
                      <IconGear />
                    </div>
                    <span>Settings</span>
                  </button>
                  <For each={MORE_VIEWS}>
                    {(item) => (
                      <button
                        type="button"
                        data-more-item={item.id}
                        class={cn(
                          'flex h-11 items-center gap-2 rounded-lg px-3 text-sm',
                          props.isActive(item.id) ? 'text-accent' : 'text-ink',
                          hoveredId() === item.id
                            ? 'bg-hover'
                            : 'hover:bg-hover'
                        )}
                        onClick={() => {
                          hapticImpact('light');
                          select(item.id);
                        }}
                      >
                        <div class="size-4 shrink-0 [&_svg]:size-4">
                          <Dynamic
                            component={item.icon}
                            triggerAnimation={hoveredId() === item.id}
                          />
                        </div>
                        <span>{item.label}</span>
                      </button>
                    )}
                  </For>
                  {/* Full-bleed divider between the list and the Views row. */}
                  <div class="-mx-1 h-px shrink-0 bg-edge" />
                  <button
                    type="button"
                    class="flex h-9 shrink-0 items-center justify-between px-3 text-sm font-medium text-ink-muted"
                    onClick={() => {
                      hapticImpact('light');
                      closeMenu();
                    }}
                  >
                    <span>Views</span>
                    {/* Center the caret over the dock's More trigger (this menu's opener) so it lines up with that button's caret. */}
                    <CaretUpIcon class="mr-11 size-6 rotate-180 text-ink" />
                  </button>
                </div>
              </div>
            </div>
          </Layer>
        </Portal>
      </Show>
    </>
  );
}

export function MobileDock() {
  const { openWithSplit } = useSplitLayout();
  const location = useLocation();

  const isActive = (id: DockId) => {
    const activeContent = globalSplitManager()?.activeSplit()?.content();
    if (!activeContent) {
      const segments = location.pathname.split('/').filter(Boolean);
      return segments[segments.length - 1] === id;
    }
    return activeContent.id === id;
  };

  const navigate = (id: DockId) => {
    // If we're already on a soup/component view, replace in-place (mergeHistory)
    // so the tab switch doesn't push a new entry into the swipe-back BG slot.
    // From any other view (document, task, etc.) treat it as forward navigation
    // so the user can swipe back to where they were.
    const fgContent = globalSplitManager()?.activeSplit()?.content();
    const isOnSoupView = fgContent?.type === 'component';
    openWithSplit({ type: 'component', id }, { mergeHistory: isOnSoupView });
  };

  return (
    <div class="flex items-center gap-3 px-(--mobile-chrome-gutter)">
      <MobileDockButton
        icon={HomeIcon}
        ariaLabel="Home"
        animateIcon={false}
        class="size-10 rounded-full"
        active={isActive('home')}
        onClick={() => navigate('home')}
      />
      <MobileDockButton
        icon={AnimatedInboxIcon}
        ariaLabel="Inbox"
        class="size-10 rounded-full"
        active={isActive('inbox')}
        onClick={() => navigate('inbox')}
      />
      <MobileDockButton
        icon={AnimatedSearchIcon}
        label="Search"
        class="h-10 flex-1 gap-1 rounded-full px-3"
        onClick={() => {
          SearchState.maybeResetState();
          // Arm the focus before opening: iOS only raises the keyboard for a
          // synchronous focus inside the gesture, so triggerFocusInput grabs a
          // temp input now and transfers to the real search input once the
          // dock region portals it in.
          triggerFocusInput(() =>
            document.getElementById('mobile-search-input')
          );
          SearchState.open();
        }}
      />
      <MorePopover isActive={isActive} onNavigate={navigate} />
      <MobileDockButton
        icon={PlusIcon}
        animateIcon={false}
        ariaLabel="Create"
        class="size-10 rounded-full"
        onClick={() => setCreateMenuOpen(true)}
      />
    </div>
  );
}
