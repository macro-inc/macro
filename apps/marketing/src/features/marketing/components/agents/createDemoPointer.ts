import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

/**
 * Where DemoCursor should point: the measured center-left of the element
 * `target()` selects inside `frame()`, or nothing when it's hidden.
 */
export function createDemoPointer(options: {
  frame: () => HTMLElement;
  target: () => string | undefined;
}) {
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  onMount(() => {
    const position = () => {
      const frame = options.frame();
      const selector = options.target();
      const target = selector
        ? frame.querySelector<HTMLElement>(selector)
        : undefined;
      if (!target) {
        setPointer(undefined);
        return;
      }
      const bounds = target.getBoundingClientRect();
      const parent = frame.getBoundingClientRect();
      setPointer({
        x: bounds.left - parent.left + Math.min(bounds.width / 2, 36),
        y: bounds.top - parent.top + bounds.height / 2,
      });
    };
    createEffect(() => {
      options.target();
      const timer = requestAnimationFrame(position);
      onCleanup(() => cancelAnimationFrame(timer));
    });
    const resize = new ResizeObserver(position);
    resize.observe(options.frame());
    onCleanup(() => resize.disconnect());
  });
  return pointer;
}
