import { makeEventListener } from '@solid-primitives/event-listener';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import {
  type Accessor,
  createEffect,
  createSignal,
  on,
  onCleanup,
} from 'solid-js';

/** Space left between a lifted toast stack and the composer below it. */
const CLEARANCE_GAP_PX = 8;

/** The least room a lifted stack keeps above it, so its top stays on screen. */
const WINDOW_MARGIN_PX = 8;

// One app-wide list, like the toast service it serves: there is a single
// toaster, and composers anywhere in the app register with it.
const [composers, setComposers] = createSignal<readonly HTMLElement[]>([]);

/**
 * Keep the app's toasts off `element`: while a toast stack would overlap it,
 * the stack moves up to just above it. Use it for a composer docked at the
 * bottom of a pane, whose send and stop controls sit where toasts appear.
 * Call it from the element's `ref`; it stops when the component unmounts.
 */
export function keepToastsClearOf(element: HTMLElement): void {
  setComposers((list) => [...list, element]);
  onCleanup(() =>
    setComposers((list) => list.filter((entry) => entry !== element))
  );
}

/**
 * Whether `composer` is on screen. A parked desktop tab and the pane behind
 * the top one on a phone stay mounted where the visible pane is, hidden with
 * `invisible` and made `inert`; their composers still report real geometry.
 * (`checkVisibility()` is newer than the Safari the app supports.)
 */
function isShown(composer: HTMLElement): boolean {
  if (composer.closest('[inert]')) return false;
  return getComputedStyle(composer).visibility === 'visible';
}

/**
 * How far `stack`, a `fixed` toast column anchored to the bottom of the
 * window, must rise so it covers no shown composer, in pixels.
 *
 * The stack is measured where it would sit unlifted: its current bottom plus
 * the lift already applied. A composer it overlaps there (sideways and
 * vertically) pushes it up until its bottom is just above that composer's
 * top, but never so far that the stack's top leaves the window. A stack with
 * no height overlaps nothing and rests at its usual spot.
 *
 * It re-measures when the stack or a composer changes size (a toast arrives,
 * a draft wraps to another line, a pane is resized), when a composer
 * registers or leaves, when a pane is hidden or shown (`inert` changes), and
 * when the window or the visual viewport resizes (an on-screen keyboard).
 * Nothing polls.
 */
export function createToastLift(
  stack: Accessor<HTMLElement | undefined>
): Accessor<number> {
  const [lift, setLift] = createSignal(0);

  const measure = () => {
    const column = stack()?.getBoundingClientRect();
    if (!column || column.height === 0) {
      setLift(0);
      return;
    }

    const bottom = column.bottom + lift();
    const top = bottom - column.height;

    let needed = 0;
    for (const composer of composers()) {
      if (!isShown(composer)) continue;

      const rect = composer.getBoundingClientRect();
      const overlapsSideways =
        rect.left < column.right && rect.right > column.left;
      const overlapsVertically = rect.top < bottom && rect.bottom > top;
      if (!overlapsSideways || !overlapsVertically) continue;

      needed = Math.max(needed, bottom - rect.top + CLEARANCE_GAP_PX);
    }

    const room = Math.max(0, top - WINDOW_MARGIN_PX);
    setLift(Math.min(needed, room));
  };

  // Resize callbacks run before paint, so a lift lands in the same frame.
  // The other triggers change layout after this frame's style, so they
  // measure on the next one.
  let frame: number | undefined;
  const measureNextFrame = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      measure();
    });
  };
  onCleanup(() => {
    if (frame !== undefined) cancelAnimationFrame(frame);
  });

  createResizeObserver(() => [stack(), ...composers()], measure);
  createEffect(on(composers, measureNextFrame, { defer: true }));
  makeEventListener(window, 'resize', measure);
  if (window.visualViewport) {
    makeEventListener(window.visualViewport, 'resize', measureNextFrame);
  }

  // Panes hide and show by toggling `inert` (parked tabs, the phone pane
  // stack), which resizes nothing. Only that attribute is watched.
  const paneVisibility = new MutationObserver(measureNextFrame);
  paneVisibility.observe(document.body, {
    subtree: true,
    attributes: true,
    attributeFilter: ['inert'],
  });
  onCleanup(() => paneVisibility.disconnect());

  return lift;
}
