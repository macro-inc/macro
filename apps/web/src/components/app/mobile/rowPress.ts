import { isTouchDevice } from '@core/mobile/isTouchDevice';

/**
 * The grey a touch list row shows while it is pressed, for every row in the
 * app. A row opts in by marking its surface `data-press-surface`; a soup row
 * container (`data-soup-entity`) takes the press for the surfaces inside it,
 * and index.css paints the pressed row's surfaces and swipe layer.
 *
 * Timing follows UIKit table rows: a finger that rests 100ms on a row shows
 * the grey, a tap that lifts sooner shows it once its click arrives, and
 * either way it stays 350ms after release. Moving 5px (a scroll or a swipe),
 * a second finger, a cancelled touch or a long press's context menu removes
 * it, so a press that turns into a scroll never flashes, and neither does a
 * tap that only stops a scroll (no click follows it).
 */

const PRESSED_CLASS = 'touch-highlight';
const PRESS_DELAY_MS = 100;
const CANCEL_DISTANCE_PX = 5;
const RELEASE_HOLD_MS = 350;
// Covers delayed split rendering after the open call completes synchronously.
const NAVIGATION_HOLD_MIN_MS = 500;

type Press = {
  row: HTMLElement;
  startX: number;
  startY: number;
  showTimer: number | undefined;
};

const releaseTimers = new WeakMap<HTMLElement, number>();
// Navigations still running from a row; it stays pressed while any are.
const navigationHolds = new WeakMap<HTMLElement, number>();

/** The row a touch or click on `target` presses, if it is in one. */
function pressedRow(target: EventTarget | null): HTMLElement | undefined {
  if (!(target instanceof Element)) return undefined;

  // A soup row container outranks the surfaces inside it, so the swipe layer
  // between them is painted too.
  const row =
    target.closest('[data-soup-entity]') ??
    target.closest('[data-press-surface]');
  return row instanceof HTMLElement ? row : undefined;
}

function cancelRelease(row: HTMLElement) {
  window.clearTimeout(releaseTimers.get(row));
  releaseTimers.delete(row);
}

function showPressed(row: HTMLElement) {
  cancelRelease(row);
  row.classList.add(PRESSED_CLASS);
}

function hidePressed(row: HTMLElement) {
  cancelRelease(row);
  if (navigationHolds.has(row)) return;
  row.classList.remove(PRESSED_CLASS);
}

function hidePressedAfter(row: HTMLElement, delay: number) {
  cancelRelease(row);
  releaseTimers.set(
    row,
    window.setTimeout(() => {
      releaseTimers.delete(row);
      if (navigationHolds.has(row)) return;
      row.classList.remove(PRESSED_CLASS);
    }, delay)
  );
}

/**
 * Remove the grey from the row `element` is in and from the rows inside it,
 * at once, even while a navigation from it runs: a long press that opens the
 * row's action menu, and that menu closing, both end the press.
 */
export function clearRowPress(element: Element) {
  const rows = [
    pressedRow(element),
    ...element.querySelectorAll<HTMLElement>(`.${PRESSED_CLASS}`),
  ];
  for (const row of rows) {
    if (!row) continue;
    cancelRelease(row);
    row.classList.remove(PRESSED_CLASS);
  }
}

/**
 * Listen for row presses across the document; only touch devices show them.
 * Returns the cleanup.
 */
export function installRowPress(): () => void {
  let press: Press | undefined;
  // A tap lifted before the delay; its click, if one comes, shows the grey.
  let tappedRow: HTMLElement | undefined;

  const targetOptions = { once: true, passive: true };

  const cancel = () => {
    if (!press) return;
    window.clearTimeout(press.showTimer);
    hidePressed(press.row);
    press = undefined;
  };

  const touchStart = (event: TouchEvent) => {
    cancel();
    tappedRow = undefined;
    if (!isTouchDevice() || event.touches.length !== 1) return;

    const row = pressedRow(event.target);
    if (!row || !(event.target instanceof Element)) return;

    // A touch's later events go to the element it started on, and reach the
    // document only while that element is in it. Listen on the element too,
    // so a press whose element is re-rendered under the finger still ends.
    event.target.addEventListener('touchend', touchEnd, targetOptions);
    event.target.addEventListener('touchcancel', cancel, targetOptions);

    const touch = event.touches[0];
    press = {
      row,
      startX: touch.clientX,
      startY: touch.clientY,
      showTimer: window.setTimeout(() => {
        if (press) press.showTimer = undefined;
        showPressed(row);
      }, PRESS_DELAY_MS),
    };
  };

  const touchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!press || !touch) return;

    const distance = Math.hypot(
      touch.clientX - press.startX,
      touch.clientY - press.startY
    );
    if (distance > CANCEL_DISTANCE_PX) cancel();
  };

  const touchEnd = () => {
    if (!press) return;

    const { row, showTimer } = press;
    press = undefined;
    if (showTimer !== undefined) {
      window.clearTimeout(showTimer);
      tappedRow = row;
      return;
    }
    hidePressedAfter(row, RELEASE_HOLD_MS);
  };

  const click = (event: MouseEvent) => {
    const row = tappedRow;
    tappedRow = undefined;
    if (!row || pressedRow(event.target) !== row) return;

    showPressed(row);
    hidePressedAfter(row, RELEASE_HOLD_MS);
  };

  const options = { capture: true, passive: true };
  document.addEventListener('touchstart', touchStart, options);
  document.addEventListener('touchmove', touchMove, options);
  document.addEventListener('touchend', touchEnd, options);
  document.addEventListener('touchcancel', cancel, options);
  document.addEventListener('pointercancel', cancel, options);
  document.addEventListener('contextmenu', cancel, options);
  document.addEventListener('click', click, true);

  return () => {
    cancel();
    document.removeEventListener('touchstart', touchStart, true);
    document.removeEventListener('touchmove', touchMove, true);
    document.removeEventListener('touchend', touchEnd, true);
    document.removeEventListener('touchcancel', cancel, true);
    document.removeEventListener('pointercancel', cancel, true);
    document.removeEventListener('contextmenu', cancel, true);
    document.removeEventListener('click', click, true);
  };
}

/**
 * Keep the row a tap opened pressed while its navigation runs, and for at
 * least 500ms. Call from the row's click handler; call the returned function
 * once the navigation settles.
 */
export function holdRowPress(
  event: MouseEvent | PointerEvent
): (() => void) | undefined {
  if (!isTouchDevice()) return undefined;

  const row = pressedRow(event.currentTarget ?? event.target);
  if (!row) return undefined;

  showPressed(row);
  navigationHolds.set(row, (navigationHolds.get(row) ?? 0) + 1);
  const startedAt = performance.now();
  let released = false;

  return () => {
    if (released) return;
    released = true;

    const holds = (navigationHolds.get(row) ?? 1) - 1;
    if (holds > 0) {
      navigationHolds.set(row, holds);
      return;
    }
    navigationHolds.delete(row);
    const elapsed = performance.now() - startedAt;
    hidePressedAfter(row, Math.max(0, NAVIGATION_HOLD_MIN_MS - elapsed));
  };
}
