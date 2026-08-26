import type { JSX } from 'solid-js';

/** How long after an input event we still consider the user to be interacting.
 *  300 ms gives async virtualizer scrolls (e.g. from hotkey-driven `scrollToId`)
 *  enough time to fire, even on slower devices or busy main threads. */
const INTERACTION_TIMEOUT_MS = 300;

/** How long after a finger lifts we still consider the user to be interacting.
 *  Touch scrolling keeps emitting scroll events while the momentum fling
 *  decays, and that coasting is still the user's scroll. */
const TOUCH_MOMENTUM_TIMEOUT_MS = 1200;

/** Finger travel needed before a touch drag counts as a direction change.
 *  Filters out the jitter of a finger resting on the screen. */
const TOUCH_DIRECTION_THRESHOLD_PX = 2;

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
   * Covers pointer (scrollbar drag), touch, wheel, and keyboard scrolling.
   */
  handlers: ScrollIntentHandlers;
};

type ScrollIntentHandlers = {
  onPointerDown: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  onPointerUp: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  onPointerCancel: JSX.EventHandlerUnion<HTMLElement, PointerEvent>;
  onTouchStart: JSX.EventHandlerUnion<HTMLElement, TouchEvent>;
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
 * - `pointerdown` / `pointerup` — covers scrollbar drag
 * - `touchstart` / `touchmove` / `touchend` — covers finger drag and the
 *   momentum fling that follows it
 * - `wheel` — covers mouse wheel / trackpad
 * - `keydown` — covers native browser keyboard scrolling (Arrow, Page, Home/End, Space)
 * - `markUserIntent()` — for external callers (e.g. hotkey-driven `scrollToId`)
 *
 * Touch is tracked with touch events rather than pointer events on purpose:
 * once the browser takes a finger drag over as a native scroll it fires
 * `pointercancel` and stops sending pointer moves, while touch events keep
 * flowing for the whole gesture. Touch moves are also the only signal that
 * carries a direction on a touch device — there are no wheel events to read.
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
export function createScrollIntentTracker(): ScrollIntentTracker {
  let isPointerDown = false;
  let isTouching = false;
  let lastTouchY: number | undefined;
  let activeUntil = 0;
  let direction: ScrollDirection | undefined;

  const markUserIntent = (dir: ScrollDirection) => {
    direction = dir;
    activeUntil = Math.max(activeUntil, Date.now() + INTERACTION_TIMEOUT_MS);
  };

  const isUserInteracting = (now = Date.now()) =>
    isPointerDown || isTouching || now < activeUntil;

  const lastDirection = (now?: number) =>
    isUserInteracting(now) ? direction : undefined;

  const endPointer = () => {
    if (!isPointerDown) return;
    isPointerDown = false;
    activeUntil = Math.max(activeUntil, Date.now() + INTERACTION_TIMEOUT_MS);
  };

  const endTouch = () => {
    if (!isTouching) return;
    isTouching = false;
    lastTouchY = undefined;
    activeUntil = Math.max(activeUntil, Date.now() + TOUCH_MOMENTUM_TIMEOUT_MS);
  };

  const handlers: ScrollIntentHandlers = {
    onPointerDown: (event) => {
      // Touch is handled by the touch handlers below.
      if (event.pointerType === 'touch') return;
      // For mouse/pen, only track scrollbar drags. Scrollbar clicks
      // target the container element itself, while clicks on child
      // elements (messages, buttons, text selection) have a different
      // target. This prevents false positives from normal click
      // interactions within the scroll container.
      if (event.target === event.currentTarget) {
        isPointerDown = true;
      }
    },
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
    onTouchStart: (event) => {
      isTouching = true;
      lastTouchY = event.touches[0]?.clientY;
    },
    onTouchMove: (event) => {
      isTouching = true;
      const y = event.touches[0]?.clientY;
      if (y === undefined) return;
      if (lastTouchY === undefined) {
        lastTouchY = y;
        return;
      }
      // The content moves opposite the finger: dragging up scrolls down.
      const delta = lastTouchY - y;
      if (Math.abs(delta) < TOUCH_DIRECTION_THRESHOLD_PX) return;
      direction = delta > 0 ? 'down' : 'up';
      lastTouchY = y;
    },
    onTouchEnd: (event) => {
      // Multi-touch: the gesture continues while any finger is still down.
      const remaining = event.touches[0]?.clientY;
      if (remaining !== undefined) {
        lastTouchY = remaining;
        return;
      }
      endTouch();
    },
    onTouchCancel: endTouch,
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
