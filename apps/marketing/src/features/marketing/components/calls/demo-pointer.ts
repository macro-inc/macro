import { createEffect, createSignal, onCleanup, onMount } from 'solid-js';

/**
 * Positions a DemoCursor over the element a walkthrough step targets,
 * measured relative to `frame` (the TaskCreationFlow approach).
 */
export function createDemoPointer(options: {
  frame: () => HTMLElement;
  target: () => string | undefined;
  active: () => boolean;
}) {
  const [pointer, setPointer] = createSignal<{ x: number; y: number }>();
  onMount(() => {
    const position = () => {
      const selector = options.target();
      const frame = options.frame();
      const target = selector
        ? frame.querySelector<HTMLElement>(selector)
        : undefined;
      if (!options.active() || !target) {
        setPointer(undefined);
        return;
      }
      const bounds = target.getBoundingClientRect();
      const parent = frame.getBoundingClientRect();
      setPointer({
        x: bounds.left - parent.left + Math.min(bounds.width / 2, 40),
        y: bounds.top - parent.top + bounds.height / 2,
      });
    };
    createEffect(() => {
      options.target();
      options.active();
      const frame = requestAnimationFrame(position);
      onCleanup(() => cancelAnimationFrame(frame));
    });
    const resize = new ResizeObserver(position);
    resize.observe(options.frame());
    onCleanup(() => resize.disconnect());
  });
  return pointer;
}
