import { createReorder } from './create-reorder';
import type { InsertionEdge } from './horizontal-insertion';
import { verticalInsertion } from './vertical-insertion';

export type VerticalReorderDrop = {
  targetId: string;
  edge: InsertionEdge;
  /** The indicator's offset within its positioned container. */
  top: number;
};

/** Drag one of a column of items to a new place in it. */
export function createVerticalReorder(options: {
  /** Every item id, top to bottom. */
  order: () => readonly string[];
  getViewport: () => HTMLElement | undefined;
  enabled: () => boolean;
  previewMarker: string;
  onDrop: (id: string, targetId: string, edge: InsertionEdge) => void;
}) {
  return createReorder<VerticalReorderDrop>({
    ...options,
    locate: ({ pointer, viewport, items, draggedId }) => {
      const bounds = viewport.getBoundingClientRect();
      const insertion = verticalInsertion({
        pointer,
        viewport: bounds,
        items,
        draggedId,
      });
      return (
        insertion && {
          targetId: insertion.targetId,
          edge: insertion.edge,
          top: insertion.boundary - bounds.top + viewport.scrollTop,
        }
      );
    },
  });
}
