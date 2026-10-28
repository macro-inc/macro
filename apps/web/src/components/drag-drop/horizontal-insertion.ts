export type InsertionRect = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

export type InsertionEdge = 'before' | 'after';

export type HorizontalInsertion = {
  targetId: string;
  edge: InsertionEdge;
  /** The x coordinate the dragged item would land on. */
  boundary: number;
};

/**
 * Where a dragged item lands in a left-to-right row: beside the item under the
 * pointer, on the side of its nearer half. Past the last item it lands after
 * that one. Nothing when the pointer leaves the viewport, or when the drop
 * would leave the order unchanged.
 */
export function horizontalInsertion(input: {
  pointer: { x: number; y: number };
  viewport: InsertionRect;
  /** How far above or below the viewport the pointer may stray. */
  verticalSlack?: number;
  /** Refuse a boundary scrolled out of the viewport. */
  boundaryInViewport?: boolean;
  /** Left to right. */
  items: readonly { id: string; rect: InsertionRect }[];
  draggedId: string;
}): HorizontalInsertion | undefined {
  const { pointer, viewport } = input;
  const slack = input.verticalSlack ?? 0;
  if (
    pointer.x < viewport.left ||
    pointer.x > viewport.right ||
    pointer.y < viewport.top - slack ||
    pointer.y > viewport.bottom + slack
  )
    return undefined;
  const target =
    input.items.find((item) => pointer.x <= item.rect.right) ??
    input.items.at(-1);
  if (!target) return undefined;
  const { rect } = target;
  const edge: InsertionEdge =
    pointer.x < (rect.left + rect.right) / 2 ? 'before' : 'after';
  const boundary = edge === 'before' ? rect.left : rect.right;
  if (
    input.boundaryInViewport &&
    (boundary < viewport.left || boundary > viewport.right)
  )
    return undefined;
  const from = input.items.findIndex((item) => item.id === input.draggedId);
  const insertion = input.items.indexOf(target) + Number(edge === 'after');
  if (from < 0 || insertion === from || insertion === from + 1)
    return undefined;
  return { targetId: target.id, edge, boundary };
}
