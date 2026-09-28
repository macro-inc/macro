import type { CollisionDetector } from '@thisbeyond/solid-dnd';

/** Hit-test visible DOM nodes so scrolling, clipping and layout changes are honored. */
export function createPointerCollisionDetector(
  pointer: () => { x: number; y: number } | undefined,
  elementAtPoint = (x: number, y: number) => document.elementFromPoint(x, y)
): CollisionDetector {
  return (draggable, droppables) => {
    const position = pointer();
    if (!position) return null;
    const element = elementAtPoint(position.x, position.y);
    if (!element) return null;

    // Walk from the actual hit toward its ancestors: a channel row wins over
    // its enclosing list, and clipped/covered rows can never win a collision.
    for (let node: Element | null = element; node; node = node.parentElement) {
      const hit = droppables.find((droppable) => {
        const disabled = droppable.data.isDropTargetDisabled as
          | (() => boolean)
          | undefined;
        return (
          droppable.node === node &&
          draggable.data.dndScope === droppable.data.dndScope &&
          !disabled?.()
        );
      });
      if (hit) return hit;
    }
    return null;
  };
}
