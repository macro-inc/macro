import {
  corners,
  enclosing,
  inverse,
  type Matrix,
  multiply,
  transformPoint,
} from './affine';
import type { Bounds, Point } from './model';
import type { ObjectSnapper, SnapGuide } from './object-snapping';
import { type ResizeHandle, resizeBox } from './resize';

/** Snap axis-aligned resize handles after grid/proportion constraints. Rotated
 * resize frames keep their local-axis behavior instead of jumping off-axis. */
export function snapObjectResize(
  bounds: Bounds,
  handle: ResizeHandle,
  delta: Point,
  modifiers: Parameters<typeof resizeBox>[3],
  world: Matrix,
  snapper: ObjectSnapper | undefined,
  scale: number
) {
  const fallback = resizeBox(bounds, handle, delta, modifiers);
  const guides: SnapGuide[] = [];
  if (!snapper || Math.abs(world[1]) > 1e-8 || Math.abs(world[2]) > 1e-8)
    return { resized: fallback, guides };
  const initial = resizeBox(bounds, handle, delta, {
    ...modifiers,
    snap: undefined,
  });
  const horizontal = handle.includes('w') || handle.includes('e');
  const vertical = handle.includes('n') || handle.includes('s');
  const moving = {
    x:
      bounds.x +
      bounds.width * (horizontal ? (handle.includes('w') ? 0 : 1) : 0.5),
    y:
      bounds.y +
      bounds.height * (vertical ? (handle.includes('n') ? 0 : 1) : 0.5),
  };
  const local = transformPoint(initial.transform, moving);
  const end = transformPoint(world, local);
  const projected = enclosing(
    corners(bounds).map((p) =>
      transformPoint(multiply(world, initial.transform), p)
    )
  );
  const match = snapper.snap(projected, scale, {
    x: horizontal ? [end.x] : [],
    y: vertical ? [end.y] : [],
  });
  if (!match.guides.length) return { resized: fallback, guides };
  let desired = transformPoint(inverse(world), {
    x: end.x + match.offset.x,
    y: end.y + match.offset.y,
  });
  if (modifiers.proportional) {
    const anchor = {
      x:
        bounds.x +
        bounds.width *
          (modifiers.fromCenter || !horizontal
            ? 0.5
            : handle.includes('w')
              ? 1
              : 0),
      y:
        bounds.y +
        bounds.height *
          (modifiers.fromCenter || !vertical
            ? 0.5
            : handle.includes('n')
              ? 1
              : 0),
    };
    const useX =
      match.guides.some((guide) => guide.axis === 'x') &&
      (!match.guides.some((guide) => guide.axis === 'y') ||
        Math.abs(match.offset.x) <= Math.abs(match.offset.y));
    const axis = useX ? 'x' : 'y';
    const distance = local[axis] - anchor[axis];
    if (Math.abs(distance) < 1e-8) return { resized: fallback, guides };
    const factor = (desired[axis] - anchor[axis]) / distance;
    desired = {
      x: anchor.x + (local.x - anchor.x) * factor,
      y: anchor.y + (local.y - anchor.y) * factor,
    };
  } else {
    const gridEnd = transformPoint(fallback.transform, moving);
    desired = {
      x: match.guides.some((guide) => guide.axis === 'x')
        ? desired.x
        : gridEnd.x,
      y: match.guides.some((guide) => guide.axis === 'y')
        ? desired.y
        : gridEnd.y,
    };
  }
  const resized = resizeBox(
    bounds,
    handle,
    { x: desired.x - moving.x, y: desired.y - moving.y },
    { ...modifiers, snap: undefined }
  );
  const final = transformPoint(multiply(world, resized.transform), moving);
  return {
    resized,
    guides: match.guides.filter(
      (guide) => Math.abs(final[guide.axis] - guide.value) * scale < 1e-5
    ),
  };
}
