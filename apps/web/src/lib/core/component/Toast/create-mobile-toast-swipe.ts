import { createSignal } from 'solid-js';

/** Choose either horizontal swipe direction before Kobalte handles the move. */
export function createMobileToastSwipe() {
  const [direction, setDirection] = createSignal<'left' | 'right'>('left');
  let swipeStart: { x: number; pointerId: number } | undefined;

  const onPointerDown = (event: PointerEvent) => {
    if (event.button === 0)
      swipeStart = { x: event.clientX, pointerId: event.pointerId };
  };
  const onPointerMove = (event: PointerEvent) => {
    if (!swipeStart || swipeStart.pointerId !== event.pointerId) return;
    const deltaX = event.clientX - swipeStart.x;
    if (deltaX !== 0) setDirection(deltaX < 0 ? 'left' : 'right');
  };
  const clearSwipe = (event: PointerEvent) => {
    if (swipeStart?.pointerId === event.pointerId) swipeStart = undefined;
  };

  return { direction, onPointerDown, onPointerMove, clearSwipe };
}
