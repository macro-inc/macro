import { createReorder } from './create-reorder';
import {
  horizontalInsertion,
  type InsertionEdge,
} from './horizontal-insertion';

export type HorizontalReorderDrop = {
  targetId: string;
  edge: InsertionEdge;
  /** The indicator's offset within its positioned container. */
  left: number;
};

/** Drag one of a row of items to a new place in it. */
export function createHorizontalReorder(options: {
  /** Every item id, left to right. */
  order: () => readonly string[];
  getViewport: () => HTMLElement | undefined;
  enabled: () => boolean;
  verticalSlack?: number;
  boundaryInViewport?: boolean;
  previewMarker: string;
  indicatorLeft: (boundary: number, viewport: HTMLElement) => number;
  onDrop: (id: string, targetId: string, edge: InsertionEdge) => void;
}) {
  return createReorder<HorizontalReorderDrop>({
    ...options,
    locate: ({ pointer, viewport, items, draggedId }) => {
      const insertion = horizontalInsertion({
        pointer,
        viewport: viewport.getBoundingClientRect(),
        verticalSlack: options.verticalSlack,
        boundaryInViewport: options.boundaryInViewport,
        items,
        draggedId,
      });
      return (
        insertion && {
          targetId: insertion.targetId,
          edge: insertion.edge,
          left: options.indicatorLeft(insertion.boundary, viewport),
        }
      );
    },
  });
}
