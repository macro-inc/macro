import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { createEffect, on, onCleanup } from 'solid-js';

type NestedScroll = {
  viewportSelector: string;
  horizontalOutside: boolean;
};

type Point = { x: number; y: number };
type Edges = { left: number; right: number; top: number; bottom: number };

function edgeVelocity(position: number, start: number, end: number) {
  const edge = Math.min(48, (end - start) / 4);
  if (edge <= 0) return 0;
  if (position < start + edge)
    return Math.max(-1, -(1 - (position - start) / edge));
  if (position > end - edge) return Math.min(1, 1 - (end - position) / edge);
  return 0;
}

function scrollLane(
  viewport: HTMLElement,
  selector: string,
  pointer: Point,
  edges: Edges,
  elapsed: number
) {
  for (const lane of viewport.querySelectorAll<HTMLElement>(selector)) {
    const rect = lane.getBoundingClientRect();
    const left = Math.max(rect.left, edges.left);
    const right = Math.min(rect.right, edges.right);
    const top = Math.max(rect.top, edges.top);
    const bottom = Math.min(rect.bottom, edges.bottom);
    if (
      pointer.x < left ||
      pointer.x > right ||
      pointer.y < top ||
      pointer.y > bottom
    )
      continue;
    const previous = lane.scrollTop;
    lane.scrollTop = Math.max(
      0,
      Math.min(
        lane.scrollHeight - lane.clientHeight,
        previous + edgeVelocity(pointer.y, top, bottom) * elapsed * 0.7
      )
    );
    return lane.scrollTop !== previous;
  }
  return false;
}

function scrollDragFrame(
  viewport: HTMLElement,
  pointer: Point,
  elapsed: number,
  options: { axis: 'x' | 'both'; nestedScroll?: NestedScroll }
) {
  const bounds = viewport.getBoundingClientRect();
  const edges = {
    left: Math.max(bounds.left, 0),
    right: Math.min(bounds.right, window.innerWidth),
    top: Math.max(bounds.top, 0),
    bottom: Math.min(bounds.bottom, window.innerHeight),
  };
  const inside =
    pointer.x >= edges.left &&
    pointer.x <= edges.right &&
    pointer.y >= edges.top &&
    pointer.y <= edges.bottom;
  // The marker opts a board into nested scrolling without changing other surfaces.
  const nested =
    options.nestedScroll &&
    viewport.querySelector(options.nestedScroll.viewportSelector)
      ? options.nestedScroll
      : undefined;
  const beforeX = viewport.scrollLeft;
  if (inside || nested?.horizontalOutside) {
    viewport.scrollLeft = Math.max(
      0,
      Math.min(
        viewport.scrollWidth - viewport.clientWidth,
        beforeX +
          edgeVelocity(pointer.x, edges.left, edges.right) * elapsed * 0.7
      )
    );
  }
  let scrolled = viewport.scrollLeft !== beforeX;
  if (inside && options.axis === 'both' && !nested) {
    const beforeY = viewport.scrollTop;
    viewport.scrollTop = Math.max(
      0,
      Math.min(
        viewport.scrollHeight - viewport.clientHeight,
        beforeY +
          edgeVelocity(pointer.y, edges.top, edges.bottom) * elapsed * 0.7
      )
    );
    scrolled ||= viewport.scrollTop !== beforeY;
  }
  if (nested) {
    scrolled =
      scrollLane(viewport, nested.viewportSelector, pointer, edges, elapsed) ||
      scrolled;
  }
  return scrolled;
}

/** Scroll the active solid-dnd surface while the pointer rests near its edge. */
export function createDragAutoScroll(options: {
  getViewport: () => HTMLElement | undefined;
  axis: 'x' | 'both';
  nestedScroll?: NestedScroll;
}) {
  const context = useDragDropContext();
  if (!context) throw new Error('Drag auto-scroll requires DragDropProvider');
  const [state, actions] = context;
  createEffect(
    on(
      () => state.active.draggableId,
      (id) => {
        if (id === null) return;
        let previousTime: number | undefined;
        let frame: number;
        const tick = (time: number) => {
          const elapsed = Math.min(time - (previousTime ?? time), 32);
          previousTime = time;
          const viewport = options.getViewport();
          const pointer = state.active.sensor?.coordinates.current;
          if (viewport && pointer) {
            if (scrollDragFrame(viewport, pointer, elapsed, options))
              actions.detectCollisions();
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        onCleanup(() => cancelAnimationFrame(frame));
      }
    )
  );
}
