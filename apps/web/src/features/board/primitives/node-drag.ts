import { type Accessor, createSignal, onCleanup } from 'solid-js';
import type { Point } from '../core/camera';

/** Screen pixels a press may wander before it becomes a drag. */
const DRAG_THRESHOLD = 4;

/** Keyboard nudges in world units; Shift moves further. */
const NUDGE = 24;
const BIG_NUDGE = 96;

/**
 * Moving nodes by hand. A press that stays put is a click (the node opens);
 * one that travels drags the node, which lands where it is released and is
 * remembered there. Escape cancels a drag in progress.
 */
export function createNodeDrag(options: {
  scale: Accessor<number>;
  /** A press has become a drag. */
  onStart?: () => void;
  onDrop: (key: string, point: Point) => void;
}) {
  const [active, setActive] = createSignal<{ key: string; point: Point }>();
  let swallowClick = false;
  let stop: (() => void) | undefined;
  onCleanup(() => stop?.());

  const start = (event: PointerEvent, key: string, origin: Point) => {
    if (event.button !== 0 || !event.isPrimary) return;
    if (
      event.target instanceof Element &&
      event.target.closest('[data-board-node-action]')
    ) {
      return;
    }
    stop?.();
    const node = event.currentTarget as HTMLElement;
    const from = { x: event.clientX, y: event.clientY };
    let dragging = false;

    const move = (moveEvent: PointerEvent) => {
      if (moveEvent.pointerId !== event.pointerId) return;
      const dx = moveEvent.clientX - from.x;
      const dy = moveEvent.clientY - from.y;
      if (!dragging) {
        if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
        dragging = true;
        node.setPointerCapture(event.pointerId);
        options.onStart?.();
      }
      moveEvent.preventDefault();
      const scale = options.scale();
      setActive({
        key,
        point: { x: origin.x + dx / scale, y: origin.y + dy / scale },
      });
    };
    const finish = (cancelled: boolean) => {
      const dropped = active();
      stop?.();
      setActive(undefined);
      if (!dragging) return;
      // The click that ends a drag must not open the node. It is dispatched
      // right after pointerup, if at all, so the guard lapses next task.
      swallowClick = true;
      setTimeout(() => {
        swallowClick = false;
      });
      if (!cancelled && dropped) options.onDrop(key, dropped.point);
    };
    const up = (upEvent: PointerEvent) => {
      if (upEvent.pointerId === event.pointerId) finish(false);
    };
    const cancel = (cancelEvent: PointerEvent) => {
      if (cancelEvent.pointerId === event.pointerId) finish(true);
    };
    const onEscape = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key !== 'Escape' || !dragging) return;
      keyEvent.preventDefault();
      keyEvent.stopPropagation();
      finish(true);
    };

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', onEscape, true);
    stop = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', cancel);
      window.removeEventListener('keydown', onEscape, true);
      stop = undefined;
    };
  };

  /** Arrow keys move a focused node; returns whether the key was handled. */
  const nudge = (event: KeyboardEvent, key: string, origin: Point) => {
    const step = event.shiftKey ? BIG_NUDGE : NUDGE;
    const delta = {
      ArrowLeft: { x: -step, y: 0 },
      ArrowRight: { x: step, y: 0 },
      ArrowUp: { x: 0, y: -step },
      ArrowDown: { x: 0, y: step },
    }[event.key];
    if (!delta) return false;
    event.preventDefault();
    options.onDrop(key, { x: origin.x + delta.x, y: origin.y + delta.y });
    return true;
  };

  return {
    start,
    nudge,
    /** Where a node is while it is being dragged. */
    position: (key: string) => {
      const current = active();
      return current?.key === key ? current.point : undefined;
    },
    isDragging: (key: string) => active()?.key === key,
    /** True once for the click that ends a drag. */
    consumeClick: () => {
      const swallow = swallowClick;
      swallowClick = false;
      return swallow;
    },
  };
}

export type NodeDrag = ReturnType<typeof createNodeDrag>;
