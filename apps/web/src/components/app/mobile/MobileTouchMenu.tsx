import './MobileTouchMenu.css';
import { hapticImpact } from '@core/mobile/haptics';
import { ICON_ANIMATION_DURATION_MS } from '@icon/animation';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, Layer } from '@ui';
import {
  type Component,
  createContext,
  createEffect,
  createSignal,
  onCleanup,
  type ParentProps,
  Show,
  useContext,
} from 'solid-js';
import { Dynamic, Portal } from 'solid-js/web';
import { pressPulse } from './pressPulse';

// Keeps the directive import from being tree-shaken / lint-flagged.
false && pressPulse;

export type MobileTouchIconComponentProps = {
  triggerAnimation?: boolean;
  class?: string;
};

export type MobileTouchIconComponent = Component<MobileTouchIconComponentProps>;

type MobileTouchMenuContextValue = {
  open: () => boolean;
  mounted: () => boolean;
  hoveredId: () => string | null;
  triggerBottomOffset: () => number;
  toggle: () => void;
  /** Animated close: plays the hide animation, then Content unmounts. */
  close: () => void;
  /** Instant removal, once the hide animation ends or a row is selected. */
  unmount: () => void;
  select: (id: string | null) => void;
  registerItem: (id: string, onSelect: () => void) => void;
  unregisterItem: (id: string) => void;
  setTriggerRef: (el: HTMLElement) => void;
  onTriggerTouchMove: (e: TouchEvent) => void;
  onTriggerTouchEnd: () => void;
};

const MobileTouchMenuContext = createContext<MobileTouchMenuContextValue>();

function useMenu(part: string) {
  const menu = useContext(MobileTouchMenuContext);
  if (!menu)
    throw new Error(`${part} must be rendered inside <MobileTouchMenu>`);
  return menu;
}

type MobileTouchMenuButtonProps = {
  icon: MobileTouchIconComponent;
  ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
  onPointerDown: () => void;
  onTouchMove?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
  class?: string;
  iconClass?: string;
  animateIcon?: boolean;
};

function MobileTouchMenuButton(props: MobileTouchMenuButtonProps) {
  const [animating, setAnimating] = createSignal(false);

  return (
    <button
      type="button"
      ref={props.ref}
      use:pressPulse
      onPointerDown={(e) => {
        e.preventDefault();
        hapticImpact('light');
        if (props.animateIcon !== false) {
          setAnimating(true);
          setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        }
        props.onPointerDown();
      }}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn('flex items-center justify-center', props.class)}
    >
      <div class={cn('size-6 [&_svg]:size-6', props.iconClass)}>
        {props.animateIcon === false ? (
          <Dynamic component={props.icon} />
        ) : (
          <Dynamic component={props.icon} triggerAnimation={animating()} />
        )}
      </div>
    </button>
  );
}

/**
 * A native-feeling touch menu: press the trigger and the menu springs open;
 * slide the still-down finger over rows (hover styling + haptics) and release
 * to select. Composed Kobalte-style — this root owns the open/selection state
 * and the parts wire up through context:
 *
 * ```tsx
 * <MobileTouchMenu>
 *   <MobileTouchMenu.Trigger icon={CaretUpIcon} />
 *   <MobileTouchMenu.Content>
 *     <MobileTouchMenu.Item id="settings" onSelect={…}>Settings</MobileTouchMenu.Item>
 *     <MobileTouchMenu.Separator />
 *     <MobileTouchMenu.Footer>Views</MobileTouchMenu.Footer>
 *   </MobileTouchMenu.Content>
 * </MobileTouchMenu>
 * ```
 *
 * The trigger renders flat: hosts wrap it in a MobileDockIsland (alone or
 * grouped with other controls) to give it the floating chrome.
 */
function MobileTouchMenuRoot(props: ParentProps) {
  // `open` drives the show/hide animation (via data-expanded); `mounted`
  // keeps the overlay in the DOM until the hide animation finishes.
  const [open, setOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  const [triggerRef, setTriggerRef] = createSignal<HTMLElement>();
  const [triggerBottomOffset, setTriggerBottomOffset] = createSignal(0);

  // Items register their action so slide-select — which hit-tests DOM rows
  // from the trigger's touch events — can dispatch by row id.
  const itemActions = new Map<string, () => void>();

  const openMenu = () => {
    // The open menu rests on the trigger's bottom edge, measured at open
    // time: dock triggers put it on the dock row, higher triggers (e.g. the
    // PillTabs overflow) hold it at their own height.
    const trigger = triggerRef();
    setTriggerBottomOffset(
      trigger
        ? Math.max(
            0,
            window.innerHeight - trigger.getBoundingClientRect().bottom
          )
        : 0
    );
    setMounted(true);
    setOpen(true);
  };

  const closeMenu = () => {
    setOpen(false);
    setHoveredId(null);
  };

  // Row selection unmounts instantly; the animated close is kept for plain
  // dismissals where the main thread is idle.
  const dismissMenu = () => {
    setOpen(false);
    setMounted(false);
    setHoveredId(null);
  };

  const select = (id: string | null) => {
    const action = id ? itemActions.get(id) : undefined;
    if (!action) return;
    action();
    dismissMenu();
  };

  const handleTouchMove = (e: TouchEvent) => {
    if (!open()) return;
    const touch = e.touches[0];
    const el = document.elementFromPoint(touch.clientX, touch.clientY);
    const button = el?.closest(
      '[data-mobile-touch-menu-item]'
    ) as HTMLElement | null;
    const id = button?.dataset.mobileTouchMenuItem ?? null;
    if (id !== hoveredId()) {
      setHoveredId(id);
      if (id) hapticImpact('light');
    }
  };

  const handleTouchEnd = () => {
    const id = hoveredId();
    setHoveredId(null);
    select(id);
  };

  return (
    <MobileTouchMenuContext.Provider
      value={{
        open,
        mounted,
        hoveredId,
        triggerBottomOffset,
        toggle: () => (open() ? closeMenu() : openMenu()),
        close: closeMenu,
        unmount: () => setMounted(false),
        select,
        registerItem: (id, onSelect) => itemActions.set(id, onSelect),
        unregisterItem: (id) => itemActions.delete(id),
        setTriggerRef: (el) => setTriggerRef(el),
        onTriggerTouchMove: handleTouchMove,
        onTriggerTouchEnd: handleTouchEnd,
      }}
    >
      {props.children}
    </MobileTouchMenuContext.Provider>
  );
}

function MobileTouchMenuTrigger(props: {
  icon: MobileTouchIconComponent;
  class?: string;
  iconClass?: string;
}) {
  const menu = useMenu('MobileTouchMenu.Trigger');

  return (
    <MobileTouchMenuButton
      ref={menu.setTriggerRef}
      icon={props.icon}
      animateIcon={false}
      onPointerDown={menu.toggle}
      onTouchMove={menu.onTriggerTouchMove}
      onTouchEnd={menu.onTriggerTouchEnd}
      class={cn('size-10 rounded-full', props.class)}
      iconClass={props.iconClass}
    />
  );
}

function MobileTouchMenuContent(props: ParentProps) {
  const menu = useMenu('MobileTouchMenu.Content');
  // The menu's natural size, fed to the open/close animation as CSS vars.
  const [menuRef, setMenuRef] = createSignal<HTMLDivElement>();
  const menuSize = createElementSize(menuRef);

  return (
    <Show when={menu.mounted()}>
      <Portal>
        {/* Portaled to <body>, outside FloatRegionHost's Layer. Re-apply
            depth 3 so the menu's surface matches the rest of the chrome. */}
        <Layer depth={3}>
          <div
            class="fixed inset-0 z-modal flex items-end justify-center"
            style={{ 'padding-bottom': `${menu.triggerBottomOffset()}px` }}
            onPointerDown={(e) => {
              if (e.target === e.currentTarget) menu.close();
            }}
          >
            <div
              class="mobile-touch-menu-content flex items-end justify-start overflow-hidden rounded-2xl border border-edge bg-menu shadow-xl"
              data-expanded={menu.open() ? '' : undefined}
              style={{
                '--mobile-touch-menu-width': menuSize.width
                  ? `${menuSize.width}px`
                  : undefined,
                '--mobile-touch-menu-height': menuSize.height
                  ? `${menuSize.height}px`
                  : undefined,
              }}
              onAnimationEnd={(e) => {
                // Icon animations bubble animationend; only unmount when the
                // container's own hide animation completes.
                if (e.target === e.currentTarget && !menu.open())
                  menu.unmount();
              }}
            >
              <div
                class="flex w-[calc(100vw-2*var(--mobile-chrome-gutter))] shrink-0 flex-col gap-1 p-1"
                ref={setMenuRef}
              >
                {props.children}
              </div>
            </div>
          </div>
        </Layer>
      </Portal>
    </Show>
  );
}

function MobileTouchMenuItem(
  props: ParentProps<{
    id: string;
    icon?: MobileTouchIconComponent;
    active?: boolean;
    /** Plain svg icons (e.g. Gear) don't accept `triggerAnimation`. */
    animateIcon?: boolean;
    onSelect: () => void;
  }>
) {
  const menu = useMenu('MobileTouchMenu.Item');

  createEffect(() => {
    const id = props.id;
    menu.registerItem(id, () => props.onSelect());
    onCleanup(() => menu.unregisterItem(id));
  });

  return (
    <button
      type="button"
      data-mobile-touch-menu-item={props.id}
      class={cn(
        'flex h-11 items-center gap-2 rounded-lg px-3 text-sm',
        props.active ? 'text-accent' : 'text-ink',
        menu.hoveredId() === props.id ? 'bg-hover' : 'hover:bg-hover'
      )}
      onClick={() => {
        hapticImpact('light');
        menu.select(props.id);
      }}
    >
      <Show when={props.icon}>
        {(Icon) => (
          <div class="size-4 shrink-0 [&_svg]:size-4">
            <Show
              when={props.animateIcon !== false}
              fallback={<Dynamic component={Icon()} />}
            >
              <Dynamic
                component={Icon()}
                triggerAnimation={menu.hoveredId() === props.id}
              />
            </Show>
          </div>
        )}
      </Show>
      <span>{props.children}</span>
    </button>
  );
}

function MobileTouchMenuSeparator() {
  return <div class="-mx-1 h-px shrink-0 bg-edge" />;
}

/** The bottom row labeling the menu; pressing it closes without selecting. */
function MobileTouchMenuFooter(props: ParentProps) {
  const menu = useMenu('MobileTouchMenu.Footer');

  return (
    <button
      type="button"
      class="flex h-9 shrink-0 items-center px-3 text-sm font-medium text-ink-muted"
      onPointerDown={() => {
        hapticImpact('light');
        menu.close();
      }}
    >
      <span>{props.children}</span>
    </button>
  );
}

export const MobileTouchMenu = Object.assign(MobileTouchMenuRoot, {
  Trigger: MobileTouchMenuTrigger,
  Content: MobileTouchMenuContent,
  Item: MobileTouchMenuItem,
  Separator: MobileTouchMenuSeparator,
  Footer: MobileTouchMenuFooter,
});
