/**
 * Shape layers as the shape tools draw them: a fill layer shaped by a
 * vector mask whose path is a rectangle or an ellipse (four Bézier arcs),
 * in canvas pixels.
 */

import type {
  IRect,
  Knot,
  NewLayer,
  Rgb,
  VectorMask,
} from '@core/psd-engine/types';

/** Handle length of a quarter circle as a fraction of its radius. */
const KAPPA = 0.5522847498;

const corner = (x: number, y: number): Knot => ({
  before: [x, y],
  anchor: [x, y],
  after: [x, y],
  linked: false,
});

function closedPath(knots: Knot[]): VectorMask {
  return {
    subpaths: [{ closed: true, op: 'combine', knots, nonzero: false, shape: 0 }],
    invert: false,
    disabled: false,
    unlinked: false,
    fillAll: false,
  };
}

/** A rectangle's outline, clockwise from the top left. */
export function rectanglePath(r: IRect): VectorMask {
  return closedPath([
    corner(r.x, r.y),
    corner(r.x + r.w, r.y),
    corner(r.x + r.w, r.y + r.h),
    corner(r.x, r.y + r.h),
  ]);
}

/** An ellipse's outline: four smooth points, clockwise from the top. */
export function ellipsePath(r: IRect): VectorMask {
  const cx = r.x + r.w / 2;
  const cy = r.y + r.h / 2;
  const rx = r.w / 2;
  const ry = r.h / 2;
  const kx = rx * KAPPA;
  const ky = ry * KAPPA;
  const smooth = (
    ax: number,
    ay: number,
    bx: number,
    by: number,
    fx: number,
    fy: number
  ): Knot => ({ before: [bx, by], anchor: [ax, ay], after: [fx, fy], linked: true });
  return closedPath([
    smooth(cx, cy - ry, cx - kx, cy - ry, cx + kx, cy - ry),
    smooth(cx + rx, cy, cx + rx, cy - ky, cx + rx, cy + ky),
    smooth(cx, cy + ry, cx + kx, cy + ry, cx - kx, cy + ry),
    smooth(cx - rx, cy, cx - rx, cy + ky, cx - rx, cy - ky),
  ]);
}

/** A new shape layer: a solid fill in `color` within the shape. */
export function shapeLayer(
  kind: 'rectangle' | 'ellipse',
  rect: IRect,
  color: Rgb
): NewLayer {
  return {
    type: 'fill',
    fill: { type: 'solid', color },
    path: kind === 'rectangle' ? rectanglePath(rect) : ellipsePath(rect),
    stroke: null,
  };
}
