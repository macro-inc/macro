import { virtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { createEffect, on, onCleanup } from 'solid-js';

/** The keyboard covers at least this much of the page while it is up. */
const KEYBOARD_MIN_HEIGHT = 120;
/** Less than this covered, and the keyboard has gone. */
const KEYBOARD_GONE_HEIGHT = 60;

/**
 * Run `closed` when the on-screen keyboard goes away, for as long as the
 * caller's owner lives.
 *
 * There are two signs, and a device gives one of them. Where the app lays
 * itself out around the keyboard (phones, the native apps) it tracks the
 * keyboard itself. Where it does not (Safari on a tablet), the page keeps its
 * size and the keyboard only shows as a visual viewport shorter than the
 * page, growing back.
 */
export function onKeyboardClosed(closed: () => void) {
  createEffect(
    on(
      virtualKeyboardVisible,
      (visible, was) => {
        if (was && !visible) closed();
      },
      { defer: true }
    )
  );

  const visual = window.visualViewport;
  if (!visual) return;
  // The tallest the viewport has been at this width is the page without a
  // keyboard. (`innerHeight` follows the keyboard on some tablets.)
  let width = visual.width;
  let full = visual.height;
  let up = false;
  const resized = () => {
    // A pinch-zoomed page also has a short visual viewport.
    if (visual.scale !== 1) return;
    if (visual.width !== width) {
      // The device was turned: start over at the new shape.
      width = visual.width;
      full = visual.height;
      up = false;
      return;
    }
    full = Math.max(full, visual.height);
    const covered = full - visual.height;
    if (covered >= KEYBOARD_MIN_HEIGHT) up = true;
    else if (up && covered <= KEYBOARD_GONE_HEIGHT) {
      up = false;
      closed();
    }
  };
  visual.addEventListener('resize', resized);
  onCleanup(() => visual.removeEventListener('resize', resized));
}
