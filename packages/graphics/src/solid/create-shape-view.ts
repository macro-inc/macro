import { type Accessor, createMemo } from 'solid-js';
import type { Matrix } from '../core/affine';
import type { ShapeItem } from '../core/model';

/** Render content only depends on shape payload. Transform reads stay live for
 * custom renderers, while geometry retains its immutable cache identity.
 */
export function createShapeView<T extends ShapeItem>(
  source: Accessor<T>,
  transform: Accessor<Matrix> = () => source().transform
): T {
  const content = createMemo(source, undefined, {
    equals: (a, b) =>
      a.id === b.id &&
      a.type === b.type &&
      a.geometry === b.geometry &&
      a.appearance === b.appearance &&
      a.placement === b.placement,
  });
  // All fields come from the same typed source, preserving kind/geometry pairing.
  return {
    get id() {
      return content().id;
    },
    get type() {
      return content().type;
    },
    get placement() {
      return content().placement;
    },
    get transform() {
      return transform();
    },
    get geometry() {
      return content().geometry;
    },
    get appearance() {
      return content().appearance;
    },
  } as T;
}
