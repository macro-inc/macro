import type { JSX } from 'solid-js';

// ── Constants ──────────────────────────────────────────────────────────

/** How long after an input event we still consider the user to be interacting. */
const INTERACTION_TIMEOUT_MS = 100;

// ── Types ──────────────────────────────────────────────────────────────

export type ScrollDirection = 'up' | 'down';

export type ScrollIntentTracker = {
  /**
   * Signal that a user-initiated navigation is about to cause a
   * programmatic scroll (e.g. hotkey-driven `scrollToId`).
   */
  markUserIntent: (direction: ScrollDirection) => void;
  /** Whether the user is currently in an active scrolling interaction. */
  isUserInteracting: (now?: number) => boolean;
  /** The direction of the last user scroll intent, if any. */
  lastDirection: () => ScrollDirection | undefined;
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
  onWheel: JSX.EventHandlerUnion<HTMLElement, WheelEvent>;
  onKeyDown: JSX.EventHandlerUnion<HTMLElement, KeyboardEvent>;
};

// ── Scroll keys ────────────────────────────────────────────────────────

const SCROLL_UP_KEYS = new Set(['ArrowUp', 'PageUp', 'Home']);
const SCROLL_DOWN_KEYS = new Set(['ArrowDown', 'PageDown', 'End', ' ']);

// ── Tracker factory ────────────────────────────────────────────────────

/**
 * Creates a scroll-intent tracker that distinguishes user-initiated scroll
 * events from programmatic / virtualizer-driven ones.
 *
 * User interaction is detected via:
 * - `pointerdown` / `pointerup` — covers scrollbar drag and touch drag
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
export function createScrollIntentTracker(): ScrollIntentTracker {
  let isPointerDown = false;
  let activeUntil = 0;
  let direction: ScrollDirection | undefined;

  const markUserIntent = (dir: ScrollDirection) => {
    direction = dir;
    activeUntil = Math.max(activeUntil, Date.now() + INTERACTION_TIMEOUT_MS);
  };

  const isUserInteracting = (now = Date.now()) =>
    isPointerDown || now < activeUntil;

  const lastDirection = () => direction;

  const endPointer = () => {
    isPointerDown = false;
    activeUntil = Math.max(activeUntil, Date.now() + INTERACTION_TIMEOUT_MS);
  };

  const handlers: ScrollIntentHandlers = {
    onPointerDown: () => {
      isPointerDown = true;
    },
    onPointerUp: endPointer,
    onPointerCancel: endPointer,
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
