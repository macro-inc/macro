import { onCleanup } from 'solid-js';

type ScrollBounds = Pick<DOMRect, 'left' | 'right' | 'top' | 'bottom'>;

/** Scroll a drag surface at frame rate, even while its pointer is stationary. */
export function createPointerAutoScroll(options: {
  getViewport: () => HTMLElement | undefined;
  getPointer: () => { x: number; y: number } | undefined;
  getBounds?: (viewport: HTMLElement) => ScrollBounds;
  axis: 'x' | 'y' | 'both';
  allowOutside?: boolean;
  onScroll?: () => void;
}) {
  let running = false;
  let frame: number | undefined;
  let previousTime: number | undefined;
  const velocity = (position: number, start: number, end: number) => {
    const edge = Math.min(48, (end - start) / 4);
    if (edge <= 0) return 0;
    if (position < start + edge)
      return -Math.min(1, 1 - (position - start) / edge);
    if (position > end - edge) return Math.min(1, 1 - (end - position) / edge);
    return 0;
  };
  const tick = (time: number) => {
    if (!running) return;
    const elapsed = Math.min(time - (previousTime ?? time), 32);
    previousTime = time;
    const viewport = options.getViewport();
    const pointer = options.getPointer();
    if (viewport && pointer) {
      const bounds =
        options.getBounds?.(viewport) ?? viewport.getBoundingClientRect();
      const left = Math.max(bounds.left, 0);
      const right = Math.min(bounds.right, window.innerWidth);
      const top = Math.max(bounds.top, 0);
      const bottom = Math.min(bounds.bottom, window.innerHeight);
      if (
        right > left &&
        bottom > top &&
        (options.allowOutside ||
          (pointer.x >= left &&
            pointer.x <= right &&
            pointer.y >= top &&
            pointer.y <= bottom))
      ) {
        const beforeX = viewport.scrollLeft;
        const beforeY = viewport.scrollTop;
        if (options.axis !== 'y')
          viewport.scrollLeft = Math.max(
            0,
            Math.min(
              viewport.scrollWidth - viewport.clientWidth,
              beforeX + velocity(pointer.x, left, right) * elapsed * 0.7
            )
          );
        if (options.axis !== 'x')
          viewport.scrollTop = Math.max(
            0,
            Math.min(
              viewport.scrollHeight - viewport.clientHeight,
              beforeY + velocity(pointer.y, top, bottom) * elapsed * 0.7
            )
          );
        if (viewport.scrollLeft !== beforeX || viewport.scrollTop !== beforeY)
          options.onScroll?.();
      }
    }
    if (running) frame = requestAnimationFrame(tick);
  };
  const start = () => {
    if (running) return;
    running = true;
    previousTime = undefined;
    frame = requestAnimationFrame(tick);
  };
  const stop = () => {
    running = false;
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    previousTime = undefined;
  };
  onCleanup(stop);
  return { start, stop };
}
