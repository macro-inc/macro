import { isTouchDevice } from '@core/mobile/isTouchDevice';
import { onCleanup } from 'solid-js';

const TOUCH_HIGHLIGHT_CLASS = 'touch-highlight';
const TOUCH_HIGHLIGHT_DELAY_MS = 20;
const SOUP_TOUCH_HIGHLIGHT_CANCEL_DISTANCE_PX = 5;
const CLICK_GRACE_MS = 350;
// Covers delayed split rendering after the open call completes synchronously.
const NAVIGATION_HIGHLIGHT_MIN_MS = 500;

type TouchHighlightState = {
  startX: number;
  startY: number;
  activeElement: HTMLElement | undefined;
  touchActive: boolean;
  enterTimer: number | undefined;
};

const createTouchHighlightState = (): TouchHighlightState => ({
  startX: 0,
  startY: 0,
  activeElement: undefined,
  touchActive: false,
  enterTimer: undefined,
});

const pendingTouchClearTimers = new WeakMap<HTMLElement, number>();
const touchListenerOptions = { passive: true, capture: true };

const clearScheduledTimer = (timer: number | undefined) => {
  if (timer !== undefined) {
    window.clearTimeout(timer);
  }
};

const clearPendingTouchClear = (element: HTMLElement) => {
  const timer = pendingTouchClearTimers.get(element);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    pendingTouchClearTimers.delete(element);
  }
};

const scheduleTouchClear = (element: HTMLElement) => {
  clearPendingTouchClear(element);

  const timer = window.setTimeout(() => {
    pendingTouchClearTimers.delete(element);
    element.classList.remove(TOUCH_HIGHLIGHT_CLASS);
  }, CLICK_GRACE_MS);

  pendingTouchClearTimers.set(element, timer);
};

const isTouchMovementCanceled = (
  touch: Touch,
  state: TouchHighlightState
): boolean => {
  const dx = touch.clientX - state.startX;
  const dy = touch.clientY - state.startY;
  return Math.hypot(dx, dy) > SOUP_TOUCH_HIGHLIGHT_CANCEL_DISTANCE_PX;
};

const soupEntityFromEvent = (event: TouchEvent) => {
  const target = event.target;
  if (!(target instanceof Element)) return undefined;

  const trigger = target.closest('[data-soup-entity]');
  if (!(trigger instanceof HTMLElement)) return undefined;

  return trigger;
};

const cancelTouchHighlight = (state: TouchHighlightState) => {
  const element = state.activeElement;
  state.touchActive = false;
  state.activeElement = undefined;
  clearScheduledTimer(state.enterTimer);
  state.enterTimer = undefined;

  if (!element) return;

  clearPendingTouchClear(element);
  element.classList.remove(TOUCH_HIGHLIGHT_CLASS);
};

export function soupNavigationTouchHighlight(container: HTMLElement) {
  if (!isTouchDevice()) return;

  const state = createTouchHighlightState();

  const handleTouchStart = (event: TouchEvent) => {
    if (event.touches.length !== 1) {
      cancelTouchHighlight(state);
      return;
    }

    const element = soupEntityFromEvent(event);
    if (!element) {
      cancelTouchHighlight(state);
      return;
    }

    const touch = event.touches[0];
    state.startX = touch.clientX;
    state.startY = touch.clientY;
    state.activeElement = element;
    state.touchActive = true;

    clearPendingTouchClear(element);
    clearScheduledTimer(state.enterTimer);
    state.enterTimer = window.setTimeout(() => {
      state.enterTimer = undefined;
      element.classList.add(TOUCH_HIGHLIGHT_CLASS);
    }, TOUCH_HIGHLIGHT_DELAY_MS);
  };

  const handleTouchMove = (event: TouchEvent) => {
    if (!state.touchActive) return;

    const touch = event.touches[0];
    if (!touch) return;

    if (isTouchMovementCanceled(touch, state)) {
      cancelTouchHighlight(state);
    }
  };

  const handleTouchEnd = (event: TouchEvent) => {
    const touch = event.changedTouches[0];
    if (!touch) return;

    state.touchActive = false;
    const element = state.activeElement;
    state.activeElement = undefined;
    clearScheduledTimer(state.enterTimer);
    state.enterTimer = undefined;

    if (element) scheduleTouchClear(element);
  };

  const handleTouchCancel = () => {
    cancelTouchHighlight(state);
  };

  container.addEventListener(
    'touchstart',
    handleTouchStart,
    touchListenerOptions
  );
  container.addEventListener(
    'touchmove',
    handleTouchMove,
    touchListenerOptions
  );
  container.addEventListener('touchend', handleTouchEnd, touchListenerOptions);
  container.addEventListener(
    'touchcancel',
    handleTouchCancel,
    touchListenerOptions
  );

  onCleanup(() => {
    cancelTouchHighlight(state);
    container.removeEventListener('touchstart', handleTouchStart, true);
    container.removeEventListener('touchmove', handleTouchMove, true);
    container.removeEventListener('touchend', handleTouchEnd, true);
    container.removeEventListener('touchcancel', handleTouchCancel, true);
  });
}

export function persistSoupNavigationTouchHighlight(
  event: MouseEvent | PointerEvent
): (() => void) | undefined {
  if (!isTouchDevice()) return undefined;

  const target = event.currentTarget ?? event.target;
  if (!(target instanceof Element)) return undefined;

  const trigger = target.closest('[data-soup-entity]');
  if (!(trigger instanceof HTMLElement)) return undefined;

  clearPendingTouchClear(trigger);
  trigger.classList.add(TOUCH_HIGHLIGHT_CLASS);

  const navigationStartedAt = performance.now();
  let navigationClearTimer: number | undefined;

  return () => {
    const elapsed = performance.now() - navigationStartedAt;
    const remaining = Math.max(0, NAVIGATION_HIGHLIGHT_MIN_MS - elapsed);

    clearScheduledTimer(navigationClearTimer);
    navigationClearTimer = window.setTimeout(() => {
      navigationClearTimer = undefined;
      trigger.classList.remove(TOUCH_HIGHLIGHT_CLASS);
    }, remaining);
  };
}
