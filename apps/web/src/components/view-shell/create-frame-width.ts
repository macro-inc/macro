import { createResizeObserver } from '@solid-primitives/resize-observer';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/**
 * Tracks an element's border-box width for layout decisions.
 *
 * The first width is read when the element mounts so the initial layout is
 * right. Later observer-reported widths apply in the next animation frame:
 * they switch breakpoints that resize observed descendants, and doing that
 * during ResizeObserver delivery drops those descendants' notifications.
 *
 * A zero width means the element is not laid out yet (a view mounting while
 * its pane is still hidden), not that it is narrow: it reads as unmeasured,
 * so breakpoints keep the wide layout instead of flashing the compact one
 * until the next frame, which a heavy first render can delay for seconds.
 */
export function createFrameWidth(
  target: Accessor<HTMLElement | undefined>
): Accessor<number | undefined> {
  const [width, setWidth] = createSignal<number>();
  let frame: number | undefined;

  const cancelFrame = () => {
    if (frame === undefined) return;
    cancelAnimationFrame(frame);
    frame = undefined;
  };

  createEffect(() => {
    const element = target();
    cancelFrame();
    setWidth(element ? laidOutWidth(element) : undefined);
  });
  createResizeObserver(target, (_, element) => {
    if (!(element instanceof HTMLElement)) return;
    cancelFrame();
    frame = requestAnimationFrame(() => {
      frame = undefined;
      setWidth(laidOutWidth(element));
    });
  });
  onCleanup(cancelFrame);

  return width;
}

function laidOutWidth(element: HTMLElement): number | undefined {
  const width = element.getBoundingClientRect().width;
  return width > 0 ? width : undefined;
}
