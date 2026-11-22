import { makeEventListener } from '@solid-primitives/event-listener';
import { createResizeObserver } from '@solid-primitives/resize-observer';
import { type Accessor, createSignal, onCleanup } from 'solid-js';

/** Space left between a lifted toast stack and the composer below it. */
const CLEARANCE_GAP_PX = 8;

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
 * How far `stack`, a `fixed` toast column anchored to the bottom of the
 * window, must rise so it covers no registered composer, in pixels.
 *
 * The stack is measured where it would sit unlifted: its current bottom plus
 * the lift already applied. A composer it overlaps there (sideways and
 * vertically) pushes it up until its bottom is just above that composer's
 * top. An empty stack has no height and overlaps nothing, so it rests at its
 * usual spot. It re-measures when the stack or a composer changes size (a
 * toast arrives, a draft wraps to another line, a pane is resized) and when
 * the window does; nothing polls.
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
      const rect = composer.getBoundingClientRect();
      const overlapsSideways =
        rect.left < column.right && rect.right > column.left;
      const overlapsVertically = rect.top < bottom && rect.bottom > top;
      if (!overlapsSideways || !overlapsVertically) continue;

      needed = Math.max(needed, bottom - rect.top + CLEARANCE_GAP_PX);
    }
    setLift(needed);
  };

  createResizeObserver(() => [stack(), ...composers()], measure);
  makeEventListener(window, 'resize', measure);

  return lift;
}
