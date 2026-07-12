import { onCleanup } from 'solid-js';

const THRESHOLD = 50;

let startX = 0;
let startY = 0;
let maxDistance = 0;

export function internalDragExceedsThreshold() {
  return maxDistance >= THRESHOLD;
}

declare module 'solid-js' {
  namespace JSX {
    interface Directives {
      internalDrag: true;
    }
  }
}

export function internalDrag(element: HTMLElement) {
  const onDragStart = (e: DragEvent) => {
    e.dataTransfer?.setData('application/x-macro-internal', '1');
    startX = e.clientX;
    startY = e.clientY;
    maxDistance = 0;
  };

  const onDrag = (e: DragEvent) => {
    // drag event fires (0, 0) when cursor leaves the viewport
    if (e.clientX === 0 && e.clientY === 0) return;
    const dist = Math.hypot(e.clientX - startX, e.clientY - startY);
    if (dist > maxDistance) maxDistance = dist;
  };

  const onDragEnd = () => {
    maxDistance = 0;
  };

  element.addEventListener('dragstart', onDragStart);
  element.addEventListener('drag', onDrag);
  element.addEventListener('dragend', onDragEnd);

  onCleanup(() => {
    element.removeEventListener('dragstart', onDragStart);
    element.removeEventListener('drag', onDrag);
    element.removeEventListener('dragend', onDragEnd);
  });
}
