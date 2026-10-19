/**
 * Blocks the next click anywhere in the window. Call it when a pointer
 * dismisses a popover or drawer: the click that ends the same press would
 * otherwise land on whatever sat beneath it. The next pointerdown lifts the
 * block, so a press that never becomes a click doesn't eat a later one.
 */
export function blockNextClick(): void {
  const block = (event: MouseEvent) => {
    event.stopPropagation();
    event.preventDefault();
  };
  window.addEventListener('click', block, { capture: true, once: true });
  window.addEventListener(
    'pointerdown',
    () => window.removeEventListener('click', block, { capture: true }),
    { capture: true, once: true }
  );
}
