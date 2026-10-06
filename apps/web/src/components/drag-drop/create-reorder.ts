import {
  type CollisionDetector,
  createDraggable,
  createDroppable,
  type DragEventHandler,
} from '@thisbeyond/solid-dnd';
import { createSignal } from 'solid-js';
import { cloneDragPreview } from './drag-preview';
import type { InsertionEdge, InsertionRect } from './horizontal-insertion';

/** Where a dragged item lands, as a reorder along one axis reports it. */
export type ReorderLanding = { targetId: string; edge: InsertionEdge };

/**
 * Drag one of a line of items to a new place in it; `locate` says where the
 * pointer lands. Spread the handlers onto the `DragDropProvider`, show
 * `preview` in its `DragOverlay` and draw `drop` as the insertion line.
 */
export function createReorder<Drop extends ReorderLanding>(options: {
  /** Every item id, in order. */
  order: () => readonly string[];
  getViewport: () => HTMLElement | undefined;
  enabled: () => boolean;
  previewMarker: string;
  locate: (input: {
    pointer: { x: number; y: number };
    viewport: HTMLElement;
    items: { id: string; rect: InsertionRect }[];
    draggedId: string;
  }) => Drop | undefined;
  onDrop: (id: string, targetId: string, edge: InsertionEdge) => void;
}) {
  const [drop, setDrop] = createSignal<Drop>();
  const [preview, setPreview] = createSignal<HTMLElement>();
  let pointerOrigin: { x: number; y: number } | undefined;
  const collisionDetector: CollisionDetector = (draggable, droppables) => {
    const viewport = options.getViewport();
    if (!pointerOrigin || !viewport || !options.enabled()) {
      setDrop(undefined);
      return null;
    }
    const byId = new Map(
      droppables.map((droppable) => [String(droppable.id), droppable])
    );
    const landing = options.locate({
      pointer: {
        x: pointerOrigin.x + draggable.transform.x,
        y: pointerOrigin.y + draggable.transform.y,
      },
      viewport,
      items: options.order().flatMap((id) => {
        const droppable = byId.get(id);
        return droppable
          ? [{ id, rect: droppable.node.getBoundingClientRect() }]
          : [];
      }),
      draggedId: String(draggable.id),
    });
    setDrop(() => landing);
    return landing ? (byId.get(landing.targetId) ?? null) : null;
  };
  const onDragStart: DragEventHandler = ({ draggable }) =>
    setPreview(cloneDragPreview(draggable.node, options.previewMarker));
  const onDragEnd: DragEventHandler = ({ draggable }) => {
    const current = drop();
    setDrop(undefined);
    setPreview(undefined);
    pointerOrigin = undefined;
    if (options.enabled() && current)
      options.onDrop(String(draggable.id), current.targetId, current.edge);
  };
  return {
    drop,
    preview,
    collisionDetector,
    onDragStart,
    onDragEnd,
    cancel: () => setDrop(undefined),
    /** Where the drag began; the pointer's travel is measured from it. */
    start: (event: MouseEvent) => {
      pointerOrigin = { x: event.clientX, y: event.clientY };
    },
  };
}

/**
 * One item of a reorder: it is both dragged and dropped on. Call inside the
 * `DragDropProvider`; a press on an `ignore` match never drags.
 */
export function createReorderItem(
  id: string,
  options: {
    canDrag: () => boolean;
    ignore: string;
    start: (event: MouseEvent) => void;
  }
) {
  const draggable = createDraggable(id);
  const droppable = createDroppable(id);
  return {
    ref: (element: HTMLElement) => {
      draggable.ref(element);
      droppable.ref(element);
    },
    onMouseDown: (event: MouseEvent) => {
      if (
        !options.canDrag() ||
        event.button !== 0 ||
        (event.target instanceof Element &&
          event.target.closest(options.ignore))
      )
        return;
      options.start(event);
      draggable.dragActivators.onmousedown?.(event);
    },
    dragging: () => draggable.isActiveDraggable,
  };
}
