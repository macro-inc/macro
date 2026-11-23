import { appNavigationSelector } from '@core/dom-selectors';
import { isEditableInput } from '@core/util/isEditableInput';
import { onCleanup } from 'solid-js';

/** A destination in a view sidebar's navigation: a folder, view or scope. */
const SIDEBAR_DESTINATION_SELECTOR =
  '[data-view-sidebar] nav [data-view-sidebar-item]';

/** A view on the app rail, which hands focus back to the split it shows. */
const RAIL_DESTINATION_SELECTOR = `${appNavigationSelector} button`;

/**
 * Destinations, or controls inside one, that open or disclose something (a
 * menu, a dialog, a picker, a folder's children) instead of choosing what a
 * pane shows.
 */
const DISCLOSURE_SELECTOR =
  '[aria-haspopup]:not([aria-haspopup="false"]), [aria-expanded], [data-view-sidebar-control]';

/**
 * Whether a pointer press at `target`, or focus on it, chooses what a pane
 * shows: a sidebar destination or a view on the rail, not a field or a
 * control inside one that opens something.
 */
function choosesDestination(target: Element): boolean {
  const destination = target.closest(
    `${SIDEBAR_DESTINATION_SELECTOR}, ${RAIL_DESTINATION_SELECTOR}`
  );
  if (!destination || isEditableInput(target)) return false;
  const disclosure = target.closest(DISCLOSURE_SELECTOR);
  return !disclosure || !destination.contains(disclosure);
}

/**
 * Whether focus on `focused` during a press at `pressed` that chose a
 * destination is that destination: the sidebar destination pressed, or the
 * one the rail's press leaves or hands focus back to.
 */
function isChosenDestination(focused: Element, pressed: Element): boolean {
  if (!choosesDestination(focused)) return false;
  if (focused.contains(pressed)) return true;
  return (
    !!pressed.closest(RAIL_DESTINATION_SELECTOR) &&
    !!focused.closest(SIDEBAR_DESTINATION_SELECTOR)
  );
}

/** Whether `event` is a primary pointer press that chooses what a pane shows. */
export function isDestinationPress(event: Event): boolean {
  return (
    event.type === 'pointerdown' &&
    event instanceof MouseEvent &&
    event.button === 0 &&
    event.target instanceof Element &&
    choosesDestination(event.target)
  );
}

// Kept for the whole document rather than per set of tabs, so tabs that
// mount after the press (the chosen destination's own view) see it too. A
// press lasts until the next key, press or focus elsewhere (a menu or dialog
// it opened); the destination it left focus on stays chosen until focus
// moves on within the page.
let press: WeakRef<Element> | undefined;
let chosen: WeakRef<Element> | undefined;
let users = 0;

const LISTENED = ['pointerdown', 'focusin', 'keydown'] as const;

function track(event: Event) {
  if (event.type === 'keydown') {
    press = undefined;
    return;
  }
  const target = event.target;
  if (!(target instanceof Element)) return;
  if (event.type === 'pointerdown') {
    press = isDestinationPress(event) ? new WeakRef(target) : undefined;
    // A press that leaves focus where it was fires no focusin: on the
    // destination pressed, or on one the rail leaves focused.
    const focused = document.activeElement;
    if (press && focused && isChosenDestination(focused, target))
      chosen = new WeakRef(focused);
    return;
  }
  // Focus coming back from outside the page lands on it again.
  const returning = event instanceof FocusEvent && !event.relatedTarget;
  if (returning && target === chosen?.deref()) return;
  const pressed = press?.deref();
  if (pressed && isChosenDestination(target, pressed)) {
    chosen = new WeakRef(target);
    return;
  }
  press = undefined;
  chosen = undefined;
}

/**
 * The sidebar destination a pointer press chose and the browser left focus
 * on, which stands for the pane it shows rather than for the sidebar. Every
 * sidebar and every set of view tabs keeps the tracking on while mounted.
 */
export function useChosenDestination(): () => Element | undefined {
  if (users++ === 0)
    for (const type of LISTENED)
      document.addEventListener(type, track, { capture: true });
  onCleanup(() => {
    if (--users > 0) return;
    for (const type of LISTENED)
      document.removeEventListener(type, track, { capture: true });
    press = undefined;
    chosen = undefined;
  });
  return () => chosen?.deref();
}
