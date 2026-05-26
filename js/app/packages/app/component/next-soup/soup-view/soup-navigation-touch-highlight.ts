import { isTouchDevice } from '@core/mobile/isTouchDevice';

const NAVIGATION_TOUCH_HIGHLIGHT_CLASS = 'navigation-touch-highlight';
const NAVIGATION_TOUCH_HIGHLIGHT_TIMEOUT_MS = 500;
const navigationTouchHighlightTimers = new WeakMap<HTMLElement, number>();

export function persistSoupNavigationTouchHighlight(
  event: MouseEvent | PointerEvent
) {
  if (!isTouchDevice()) return false;

  const target = event.currentTarget ?? event.target;
  if (!(target instanceof Element)) return false;

  const trigger = target.closest('[data-soup-entity]');
  if (!(trigger instanceof HTMLElement)) return false;

  trigger.classList.add(NAVIGATION_TOUCH_HIGHLIGHT_CLASS);

  const existingTimer = navigationTouchHighlightTimers.get(trigger);
  if (existingTimer !== undefined) {
    window.clearTimeout(existingTimer);
  }

  const timer = window.setTimeout(() => {
    trigger.classList.remove(NAVIGATION_TOUCH_HIGHLIGHT_CLASS);
    navigationTouchHighlightTimers.delete(trigger);
  }, NAVIGATION_TOUCH_HIGHLIGHT_TIMEOUT_MS);

  navigationTouchHighlightTimers.set(trigger, timer);
  return true;
}
