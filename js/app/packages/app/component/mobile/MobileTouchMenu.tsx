import './MobileTouchMenu.css';
import { hapticImpact } from '@core/mobile/haptics';
import { isNativeMobilePlatform } from '@core/mobile/isNativeMobilePlatform';
import { ICON_ANIMATION_DURATION_MS } from '@icon/animation';
import CaretUpIcon from '@phosphor/caret-up.svg';
import { createElementSize } from '@solid-primitives/resize-observer';
import { cn, Layer } from '@ui';
import {
  type Component,
  createSignal,
  For,
  Show,
  type JSXElement,
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

export type MobileTouchMenuItem = {
  id: string;
  label: JSXElement;
  icon?: MobileTouchIconComponent;
  active?: () => boolean;
  animateIcon?: boolean;
  onSelect: () => void;
};

export type MobileTouchMenuTriggerProps = {
  open: boolean;
  ref: (el: HTMLElement) => void;
  onPointerDown: () => void;
  onClick: (e: MouseEvent) => void;
  onTouchMove: (e: TouchEvent) => void;
  onTouchEnd: (e: TouchEvent) => void;
};

type MobileTouchMenuButtonProps = {
  icon: MobileTouchIconComponent;
  ariaLabel: string;
  ref?: HTMLButtonElement | ((el: HTMLButtonElement) => void);
  onClick: () => void;
  onTouchMove?: (e: TouchEvent) => void;
  onTouchEnd?: (e: TouchEvent) => void;
  class?: string;
  animateIcon?: boolean;
  fireOnPress?: boolean;
};

function MobileTouchMenuButton(props: MobileTouchMenuButtonProps) {
  const [animating, setAnimating] = createSignal(false);

  return (
    <button
      type="button"
      ref={props.ref}
      aria-label={props.ariaLabel}
      use:pressPulse
      onPointerDown={() => {
        hapticImpact('light');
        if (props.animateIcon !== false) {
          setAnimating(true);
          setTimeout(() => setAnimating(false), ICON_ANIMATION_DURATION_MS);
        }
        if (props.fireOnPress) props.onClick();
      }}
      onClick={(e) => {
        if (props.fireOnPress) {
          // Keyboard/assistive activation dispatches click without pointerdown.
          if (e.detail === 0) props.onClick();
          return;
        }
        props.onClick();
      }}
      onTouchMove={props.onTouchMove}
      onTouchEnd={props.onTouchEnd}
      class={cn(
        'island pointer-events-auto flex items-center justify-center',
        props.class
      )}
    >
      <div class="size-6 [&_svg]:size-6">
        {props.animateIcon === false ? (
          <Dynamic component={props.icon} />
        ) : (
          <Dynamic component={props.icon} triggerAnimation={animating()} />
        )}
      </div>
    </button>
  );
}

// Touch menu triggers open on pointer-down, which also arms the
// hold-and-drag-to-select gesture. Swallow the opening touch's trailing
// synthesized click so it cannot accidentally select a freshly-mounted row.
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

export function MobileTouchMenu(props: {
  triggerIcon?: MobileTouchIconComponent;
  triggerAriaLabel: string;
  trigger?: (props: MobileTouchMenuTriggerProps) => JSXElement;
  position?: 'bottom-row' | 'trigger-bottom';
  footerLabel: string;
  footerCaretClass?: string;
  items: MobileTouchMenuItem[];
}) {
  // `open` drives the show/hide animation (via data-expanded); `mounted`
  // keeps the overlay in the DOM until the hide animation finishes.
  const [open, setOpen] = createSignal(false);
  const [mounted, setMounted] = createSignal(false);
  const [hoveredId, setHoveredId] = createSignal<string | null>(null);
  // The menu's natural size, fed to the open/close animation as CSS vars.
  const [menuRef, setMenuRef] = createSignal<HTMLDivElement>();
  const [triggerRef, setTriggerRef] = createSignal<HTMLElement>();
  const [triggerBottomOffset, setTriggerBottomOffset] = createSignal<number>();
  const menuSize = createElementSize(menuRef);

  const position = () => props.position ?? 'bottom-row';
  const triggerPositioned = () =>
    position() === 'trigger-bottom' && triggerBottomOffset() !== undefined;

  const syncTriggerPosition = () => {
    if (position() !== 'trigger-bottom') {
      setTriggerBottomOffset(undefined);
      return;
    }
    const trigger = triggerRef();
    if (!trigger) {
      setTriggerBottomOffset(undefined);
      return;
    }
    setTriggerBottomOffset(
      Math.max(0, window.innerHeight - trigger.getBoundingClientRect().bottom)
    );
  };

  const openMenu = () => {
    syncTriggerPosition();
    setMounted(true);
    setOpen(true);
    suppressNextClick();
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

  const toggleMenu = () => (open() ? closeMenu() : openMenu());

  const getItem = (id: string | null) =>
    id ? props.items.find((item) => item.id === id) : undefined;

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

  const select = (id: string | null) => {
    const item = getItem(id);
    if (!item) return;
    item.onSelect();
    dismissMenu();
  };

  const handleTouchEnd = () => {
    const id = hoveredId();
    setHoveredId(null);
    select(id);
  };

  const triggerProps = (): MobileTouchMenuTriggerProps => ({
    open: open(),
    ref: setTriggerRef,
    onPointerDown: () => {
      hapticImpact('light');
      toggleMenu();
    },
    onClick: (e) => {
      // Keyboard/assistive activation dispatches click without pointerdown.
      if (e.detail === 0) toggleMenu();
    },
    onTouchMove: handleTouchMove,
    onTouchEnd: handleTouchEnd,
  });

  return (
    <>
      <Show
        when={props.trigger}
        fallback={
          <MobileTouchMenuButton
            ref={setTriggerRef}
            icon={props.triggerIcon!}
            ariaLabel={props.triggerAriaLabel}
            animateIcon={false}
            fireOnPress
            onClick={toggleMenu}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
            class="size-10 rounded-full"
          />
        }
      >
        {(trigger) => trigger()(triggerProps())}
      </Show>
      <Show when={mounted()}>
        <Portal>
          {/* Portaled to <body>, outside FloatRegionHost's Layer. Re-apply
              depth 3 so the menu's surface matches the rest of the chrome. */}
          <Layer depth={3}>
            <div
              class={cn(
                'fixed inset-0 z-modal flex items-end justify-center',
                !triggerPositioned() && 'pb-3',
                !triggerPositioned() && isNativeMobilePlatform() && 'pb-7'
              )}
              style={{
                'padding-bottom': triggerPositioned()
                  ? `${triggerBottomOffset()}px`
                  : undefined,
              }}
              onPointerDown={(e) => {
                if (e.target === e.currentTarget) closeMenu();
              }}
            >
              <div
                class="mobile-touch-menu-content flex items-end justify-start overflow-hidden rounded-2xl bg-menu ring ring-edge shadow-xl"
                data-expanded={open() ? '' : undefined}
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
                  if (e.target === e.currentTarget && !open())
                    setMounted(false);
                }}
              >
                <div
                  class="flex w-[calc(100vw-2*var(--mobile-chrome-gutter))] shrink-0 flex-col gap-1 p-1"
                  ref={setMenuRef}
                >
                  <For each={props.items}>
                    {(item) => (
                      <button
                        type="button"
                        data-mobile-touch-menu-item={item.id}
                        class={cn(
                          'flex h-11 items-center gap-2 rounded-lg px-3 text-sm',
                          item.active?.() ? 'text-accent' : 'text-ink',
                          hoveredId() === item.id
                            ? 'bg-hover'
                            : 'hover:bg-hover'
                        )}
                        onClick={() => {
                          hapticImpact('light');
                          select(item.id);
                        }}
                      >
                        <Show when={item.icon}>
                          {(Icon) => (
                            <div class="size-4 shrink-0 [&_svg]:size-4">
                              <Show
                                when={item.animateIcon !== false}
                                fallback={<Dynamic component={Icon()} />}
                              >
                                <Dynamic
                                  component={Icon()}
                                  triggerAnimation={hoveredId() === item.id}
                                />
                              </Show>
                            </div>
                          )}
                        </Show>
                        <span>{item.label}</span>
                      </button>
                    )}
                  </For>
                  <div class="-mx-1 h-px shrink-0 bg-edge" />
                  <button
                    type="button"
                    class="flex h-9 shrink-0 items-center justify-between px-3 text-sm font-medium text-ink-muted"
                    onClick={() => {
                      hapticImpact('light');
                      closeMenu();
                    }}
                  >
                    <span>{props.footerLabel}</span>
                    <CaretUpIcon
                      class={cn(
                        'size-6 rotate-180 text-ink',
                        props.footerCaretClass
                      )}
                    />
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
