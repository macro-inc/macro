import type { JSX } from 'solid-js';

/** How long after an input event we still consider the user to be interacting.
 *  300 ms gives async virtualizer scrolls (e.g. from hotkey-driven `scrollToId`)
 *  enough time to fire, even on slower devices or busy main threads. */
const INTERACTION_TIMEOUT_MS = 300;
const TOUCH_DRAG_THRESHOLD_PX = 6;

export type ScrollDirection = 'up' | 'down';

type ScrollIntentTracker = {
  /**
   * Signal that a user-initiated navigation is about to cause a
   * programmatic scroll (e.g. hotkey-driven `scrollToId`).
   */
  markUserIntent: (direction: ScrollDirection) => void;
  /** Whether the user is currently in an active scrolling interaction. */
  isUserInteracting: (now?: number) => boolean;
  /** The direction of the last user scroll intent, or undefined if the
   *  user is no longer interacting (prevents stale direction reads). */
  lastDirection: (now?: number) => ScrollDirection | undefined;
  /**
   * Event handler props to spread onto the scrollable container element.
   * Covers pointer (scrollbar drag + touch), wheel, and keyboard scrolling.
   */
  handlers: ScrollIntentHandlers;
};

type ScrollIntentHandlers = {
  onPointerDown: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  onPointerUp: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  onPointerCancel: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  onTouchMove: JSX.EventHandlerUnion<HTMLElement, TouchEvent>;
  onTouchEnd: JSX.EventHandlerUnion<HTMLElement, TouchEvent>;
  onTouchCancel: JSX.EventHandlerUnion<HTMLElement, TouchEvent>;
  onWheel: JSX.EventHandlerUnion<HTMLElement, WheelEvent>;
  onKeyDown: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>;
};

const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
const SCROLL_DOWN_KEYS = new Set(['ArrowDown', 'PageDown', 'End', ' ']);

/**
 * Creates a scroll-intent tracker that distinguishes user-initiated scroll
 * events from programmatic / virtualizer-driven ones.
 *
 * User interaction is detected via:
 * - Pointer events — covers scrollbar drag
 * - Touch movement — covers finger drag without treating taps as navigation
 * - `wheel` — covers mouse wheel / trackpad
 * - `keydown` — covers native browser keyboard scrolling (Arrow, Page, Home/End, Space)
 * - `markUserIntent()` — for external callers (e.g. hotkey-driven `scrollToId`)
 *
 * Usage:
 * ```tsx
 * const scrollIntent = createScrollIntentTracker();
 *
 * <div {...scrollIntent.handlers}>
 *   ...scrollable content...
 * </div>
 *
 * function onScroll() {
 *   if (scrollIntent.isUserInteracting()) {
 *     // user-initiated scroll — safe to paginate
 *   }
 * }
 * ```
 */
export function createScrollIntentTracker(
  onUserIntent?: () => void
): ScrollIntentTracker {
  let isPointerDown = false;
  let touchY: number | undefined;
  let activeUntil = 0;
  let direction: ScrollDirection | undefined;

  const markUserIntent = (dir: ScrollDirection) => {
    direction = dir;
    activeUntil = Math.max(activeUntil, Date.now() + INTERACTION_TIMEOUT_MS);
    onUserIntent?.();
  };

  const isUserInteracting = (now = Date.now()) =>
    isPointerDown || now < activeUntil;

  const lastDirection = (now?: number) =>
    isUserInteracting(now) ? direction : undefined;

  const endPointer = () => {
    touchY = undefined;
    if (!isPointerDown) return;
    isPointerDown = false;
    activeUntil = Math.max(activeUntil, Date.now() + INTERACTION_TIMEOUT_MS);
  };

  const handlers: ScrollIntentHandlers = {
    onPointerDown: (event) => {
      if (event.pointerType === 'touch') {
        isPointerDown = true;
        touchY = event.clientY;
        return;
      }
      // For mouse/pen, only track scrollbar drags. Scrollbar clicks
      // target the container element itself, while clicks on child
      // elements (messages, buttons, text selection) have a different
      // target. This prevents false positives from normal click
      // interactions within the scroll container.
      if (event.target === event.currentTarget) {
        isPointerDown = true;
        onUserIntent?.();
      }
    },
    onPointerUp: endPointer,
    onPointerCancel: (event) => {
      // Native touch scrolling cancels pointer events before the drag ends.
      if (event.pointerType !== 'touch') endPointer();
    },
    onTouchMove: (event) => {
      const touch = event.touches[0];
      if (touchY === undefined || !touch) return;
      const delta = touchY - touch.clientY;
      if (Math.abs(delta) < TOUCH_DRAG_THRESHOLD_PX) return;
      touchY = touch.clientY;
      markUserIntent(delta > 0 ? 'down' : 'up');
    },
    onTouchEnd: endPointer,
    onTouchCancel: endPointer,
    onWheel: (event) => {
      if (event.deltaY === 0) return;
      markUserIntent(event.deltaY > 0 ? 'down' : 'up');
    },
    onKeyDown: (event) => {
      if (SCROLL_UP_KEYS.has(event.key)) {
        markUserIntent('up');
      } else if (SCROLL_DOWN_KEYS.has(event.key)) {
        markUserIntent('down');
      }
    },
  };

  return { markUserIntent, isUserInteracting, lastDirection, handlers };
}
