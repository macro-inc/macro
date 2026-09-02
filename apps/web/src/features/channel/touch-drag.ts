/**
 * How far a touch must travel before it counts as the user taking over the
 * scroll. Below it the gesture is a tap — opening a message, pressing a
 * reaction, or the stray touch that lands while a channel is still opening —
 * and must never cancel an in-flight programmatic scroll.
 */
const TOUCH_DRAG_THRESHOLD_PX = 8;

/**
 * Calls `onDrag` the first time a touch on `element` moves past the drag
 * threshold; taps never fire it. Returns a disposer.
 *
 * Touch events (not pointer events) because iOS fires `pointercancel` — and
 * stops sending `pointermove` — the moment the browser takes over scrolling,
 * which is exactly the gesture that has to be detected.
 */
export function watchTouchDrag(
  element: HTMLElement,
  onDrag: () => void
): () => void {
  let start: { x: number; y: number } | undefined;

  const handleTouchStart = (event: TouchEvent) => {
    const touch = event.touches[0];
    start = touch ? { x: touch.clientX, y: touch.clientY } : undefined;
  };

  const handleTouchMove = (event: TouchEvent) => {
    const touch = event.touches[0];
    if (!start || !touch) return;
    if (
      Math.abs(touch.clientX - start.x) <= TOUCH_DRAG_THRESHOLD_PX &&
      Math.abs(touch.clientY - start.y) <= TOUCH_DRAG_THRESHOLD_PX
    ) {
      return;
    }
    start = undefined;
    onDrag();
  };

  const handleTouchEnd = () => {
    start = undefined;
  };

  element.addEventListener('touchstart', handleTouchStart, { passive: true });
  element.addEventListener('touchmove', handleTouchMove, { passive: true });
  element.addEventListener('touchend', handleTouchEnd, { passive: true });
  element.addEventListener('touchcancel', handleTouchEnd, { passive: true });

  return () => {
    element.removeEventListener('touchstart', handleTouchStart);
    element.removeEventListener('touchmove', handleTouchMove);
    element.removeEventListener('touchend', handleTouchEnd);
    element.removeEventListener('touchcancel', handleTouchEnd);
  };
}
