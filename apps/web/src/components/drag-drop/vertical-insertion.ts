import {
  type HorizontalInsertion,
  horizontalInsertion,
  type InsertionRect,
} from './horizontal-insertion';

const transposed = (rect: InsertionRect): InsertionRect => ({
  left: rect.top,
  right: rect.bottom,
  top: rect.left,
  bottom: rect.right,
});

/**
 * `horizontalInsertion` turned on its side: where a dragged item lands in a
 * top-to-bottom column, `boundary` being the y coordinate it lands on.
 */
export function verticalInsertion(input: {
  pointer: { x: number; y: number };
  viewport: InsertionRect;
  /** Top to bottom. */
  items: readonly { id: string; rect: InsertionRect }[];
  draggedId: string;
}): HorizontalInsertion | undefined {
  return horizontalInsertion({
    pointer: { x: input.pointer.y, y: input.pointer.x },
    viewport: transposed(input.viewport),
    items: input.items.map((item) => ({
      id: item.id,
      rect: transposed(item.rect),
    })),
    draggedId: input.draggedId,
  });
}
