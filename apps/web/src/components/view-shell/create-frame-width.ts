import { createResizeObserver } from '@solid-primitives/resize-observer';
import { type Accessor, createEffect, createSignal, onCleanup } from 'solid-js';

/**
 * Tracks an element's border-box width for layout decisions.
 *
 * The first width is read when the element mounts so the initial layout is
 * right. Later observer-reported widths apply in the next animation frame:
 * they switch breakpoints that resize observed descendants, and doing that
 * during ResizeObserver delivery drops those descendants' notifications.
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
    setWidth(element?.getBoundingClientRect().width);
  });
  createResizeObserver(target, (_, element) => {
    if (!(element instanceof HTMLElement)) return;
    cancelFrame();
    frame = requestAnimationFrame(() => {
      frame = undefined;
      setWidth(element.getBoundingClientRect().width);
    });
  });
  onCleanup(cancelFrame);

  return width;
}
