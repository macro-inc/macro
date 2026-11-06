import { onCleanup } from 'solid-js';

/** How far a press moves before it is a drag rather than a tap or click. */
export const DRAG_SLOP = 8;
/** Pixels inside each edge of the visible area where a drag starts scrolling. */
const EDGE = 24;
/** Scroll speed, in pixels per second, per pixel of the pointer's edge depth. */
const RATE = 20;

/**
 * How far a point is into the edge zones of a visible span: negative toward
 * its start, positive toward its end, and 0 between them.
 */
function edgeDepth(point: number, start: number, end: number) {
  const edge = Math.min(EDGE, (end - start) / 4);
  if (point < start + edge) return point - start - edge;
  if (point > end - edge) return point - end + edge;
  return 0;
}

/**
 * Scroll a container while a dragged pointer is near or past the edges of its
 * visible area, faster the farther out it is. Sticky headers (`inset`) stay in
 * place, so the start edges are their inner sides.
 */
export function createDragAutoScroll(options: {
  element: () => HTMLElement;
  inset: () => { left: number; top: number };
  /** The only axis to scroll, for a drag that moves along one. */
  axis: () => 'x' | 'y' | undefined;
  /** Each frame the pointer is in an edge zone, after scrolling. */
  onEdge: (x: number, y: number) => void;
  /** The followed pointer moved without its button; the window missed its release. */
  onLostRelease: () => void;
}) {
  let pointer:
    | {
        id: number;
        x: number;
        y: number;
        time?: number;
        carryX: number;
        carryY: number;
      }
    | undefined;
  let frame: number | undefined;

  function scroll(time: number) {
    if (!pointer) return;
    frame = requestAnimationFrame(scroll);
    const elapsed = Math.min(100, time - (pointer.time ?? time - 16));
    pointer.time = time;
    const element = options.element();
    const rect = element.getBoundingClientRect();
    const inset = options.inset();
    const axis = options.axis();
    const x =
      axis === 'y'
        ? 0
        : edgeDepth(pointer.x - rect.left, inset.left, element.clientWidth);
    const y =
      axis === 'x'
        ? 0
        : edgeDepth(pointer.y - rect.top, inset.top, element.clientHeight);
    // Scroll whole pixels and carry the rest, so slow speeds keep their rate
    // at any frame rate.
    const distanceX = x && pointer.carryX + (x * RATE * elapsed) / 1000;
    const distanceY = y && pointer.carryY + (y * RATE * elapsed) / 1000;
    pointer.carryX = distanceX % 1;
    pointer.carryY = distanceY % 1;
    if (!x && !y) return;
    element.scrollLeft += Math.trunc(distanceX);
    element.scrollTop += Math.trunc(distanceY);
    options.onEdge(pointer.x, pointer.y);
  }

  function stop() {
    if (frame !== undefined) cancelAnimationFrame(frame);
    frame = undefined;
    pointer = undefined;
  }
  onCleanup(stop);

  return {
    /** Follow a drag's pointer: from its first move, or now when `moved`. */
    follow(event: PointerEvent, moved = false) {
      stop();
      pointer = {
        id: event.pointerId,
        x: event.clientX,
        y: event.clientY,
        carryX: 0,
        carryY: 0,
      };
      if (moved) frame = requestAnimationFrame(scroll);
    },
    move(event: PointerEvent) {
      if (!pointer || pointer.id !== event.pointerId) return;
      if (!(event.buttons & 1)) {
        stop();
        options.onLostRelease();
      } else if (
        frame !== undefined ||
        Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >
          DRAG_SLOP
      ) {
        pointer.x = event.clientX;
        pointer.y = event.clientY;
        frame ??= requestAnimationFrame(scroll);
      }
    },
    stop,
  };
}
