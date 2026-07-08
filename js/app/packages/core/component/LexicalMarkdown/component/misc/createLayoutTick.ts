import { createSignal, onCleanup } from 'solid-js';

/**
 * Returns a reactive tick counter and a bump function. Reading `layoutTick()`
 * inside a memo subscribes it to layout changes; call `bumpLayout()` on scroll,
 * resize, or any event that moves DOM elements without triggering reactive state.
 *
 * Scroll and resize listeners are registered immediately and cleaned up via
 * onCleanup — call this inside a reactive root (component, createRoot, etc.).
 */
export function createLayoutTick(): {
  layoutTick: () => number;
  bumpLayout: () => void;
} {
  const [layoutTick, setLayoutTick] = createSignal(0);
  // Void body: Lexical treats an update listener's return value as a cleanup fn.
  const bumpLayout = () => {
    setLayoutTick((t) => t + 1);
  };

  document.addEventListener('scroll', bumpLayout, {
    capture: true,
    passive: true,
  });
  window.addEventListener('resize', bumpLayout);

  onCleanup(() => {
    document.removeEventListener('scroll', bumpLayout, { capture: true });
    window.removeEventListener('resize', bumpLayout);
  });

  return { layoutTick, bumpLayout };
}
