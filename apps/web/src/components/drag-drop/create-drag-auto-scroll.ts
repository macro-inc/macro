import { useDragDropContext } from '@thisbeyond/solid-dnd';
import { createEffect, on, onCleanup } from 'solid-js';

/** Scroll the active solid-dnd surface while the pointer rests near its edge. */
export function createDragAutoScroll(options: {
  getViewport: () => HTMLElement | undefined;
  axis: 'x' | 'both';
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
            const bounds = viewport.getBoundingClientRect();
            const left = Math.max(bounds.left, 0);
            const right = Math.min(bounds.right, window.innerWidth);
            const top = Math.max(bounds.top, 0);
            const bottom = Math.min(bounds.bottom, window.innerHeight);
            if (
              pointer.x >= left &&
              pointer.x <= right &&
              pointer.y >= top &&
              pointer.y <= bottom
            ) {
              const velocity = (
                position: number,
                start: number,
                end: number
              ) => {
                const edge = Math.min(48, (end - start) / 4);
                if (edge <= 0) return 0;
                if (position < start + edge)
                  return -(1 - (position - start) / edge);
                if (position > end - edge) return 1 - (end - position) / edge;
                return 0;
              };
              const beforeX = viewport.scrollLeft;
              const beforeY = viewport.scrollTop;
              viewport.scrollLeft = Math.max(
                0,
                Math.min(
                  viewport.scrollWidth - viewport.clientWidth,
                  beforeX + velocity(pointer.x, left, right) * elapsed * 0.7
                )
              );
              if (options.axis === 'both') {
                viewport.scrollTop = Math.max(
                  0,
                  Math.min(
                    viewport.scrollHeight - viewport.clientHeight,
                    beforeY + velocity(pointer.y, top, bottom) * elapsed * 0.7
                  )
                );
              }
              if (
                viewport.scrollLeft !== beforeX ||
                viewport.scrollTop !== beforeY
              )
                actions.detectCollisions();
            }
          }
          frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        onCleanup(() => cancelAnimationFrame(frame));
      }
    )
  );
}
