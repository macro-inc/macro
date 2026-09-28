import {
  corners,
  IDENTITY,
  inverse,
  type Matrix,
  transformPoint,
} from '../affine';
import { resolveAppearance } from '../appearance';
import type { Point } from '../model';
import { segmentDistance } from './box-geometry';
import type { ShapeDefinition } from './definition';
import {
  freezeLabeledGeometry,
  hitShapeLabel,
  type LabeledGeometry,
  resizeLabeledShape,
  sameLabeledGeometry,
  validLabeledGeometry,
} from './label';

export type EllipseGeometry = LabeledGeometry;
const normalized = (g: EllipseGeometry, p: Point): Point => ({
  x: p.x / (g.width / 2) - 1,
  y: p.y / (g.height / 2) - 1,
});

/** Distance to an affine ellipse, measured in world units (including shear).
 * Principal axes turn it into an axis-aligned ellipse. The closest boundary point
 * solves q_i = axis_i² * p_i / (lambda + axis_i²), constrained to the ellipse.
 */
function outlineDistance(
  g: EllipseGeometry,
  world: Matrix,
  local: Point
): number {
  const rx = g.width / 2,
    ry = g.height / 2;
  const ux = world[0] * rx,
    uy = world[1] * rx;
  const vx = world[2] * ry,
    vy = world[3] * ry;
  const xx = ux * ux + vx * vx,
    yy = uy * uy + vy * vy,
    xy = ux * uy + vx * vy;
  const majorSquared = (xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2;
  const major = Math.sqrt(majorSquared);
  const minor = Math.abs(ux * vy - uy * vx) / major;
  const angle = Math.atan2(2 * xy, xx - yy) / 2;
  const c = Math.cos(angle),
    s = Math.sin(angle);
  const dx = world[0] * (local.x - rx) + world[2] * (local.y - ry);
  const dy = world[1] * (local.x - rx) + world[3] * (local.y - ry);
  const x = Math.abs(c * dx + s * dy) / major;
  const y = Math.abs(-s * dx + c * dy) / major;
  const b = minor / major,
    b2 = b * b;
  if (y < 1e-14) {
    const qx = x < 1 - b2 ? x / (1 - b2) : 1;
    const qy = b * Math.sqrt(Math.max(0, 1 - qx * qx));
    return Math.hypot(x - qx, y - qy) * major;
  }
  let low = -b2,
    high = Math.hypot(x, b * y);
  for (let i = 0; i < 80; i++) {
    const lambda = (low + high) / 2;
    if ((x / (lambda + 1)) ** 2 + ((b * y) / (lambda + b2)) ** 2 > 1)
      low = lambda;
    else high = lambda;
  }
  const lambda = (low + high) / 2;
  return Math.hypot(x - x / (lambda + 1), y - (b2 * y) / (lambda + b2)) * major;
}
export const ellipseDefinition: ShapeDefinition<'ellipse'> = {
  type: 'ellipse',
  label: 'Ellipse',
  validateGeometry: validLabeledGeometry,
  freezeGeometry: freezeLabeledGeometry,
  bounds: (item) => ({
    x: 0,
    y: 0,
    width: item.geometry.width,
    height: item.geometry.height,
  }),
  resize: (item, size, context) =>
    resizeLabeledShape(item, size, context?.measureText),
  sameGeometry: (a, b) => sameLabeledGeometry(a.geometry, b.geometry),
  hitTest: (item, p, context) => {
    const style = resolveAppearance(item.appearance);
    if (style.opacity === 0) return false;
    if (hitShapeLabel(item, p)) return true;
    const unit = normalized(item.geometry, p);
    if (
      item.appearance.fill !== 'transparent' &&
      Math.hypot(unit.x, unit.y) <= 1
    )
      return true;
    if (style.stroke === 'transparent' || style.strokeWidth === 0) return false;
    return (
      outlineDistance(item.geometry, IDENTITY, p) <= style.strokeWidth / 2 ||
      outlineDistance(item.geometry, context.worldTransform, p) <=
        context.tolerance + 1e-10
    );
  },
  intersectsBox: (item, world, box) => {
    const center = transformPoint(world, {
      x: item.geometry.width / 2,
      y: item.geometry.height / 2,
    });
    if (
      center.x >= box.x &&
      center.x <= box.x + box.width &&
      center.y >= box.y &&
      center.y <= box.y + box.height
    )
      return true;
    const inverseWorld = inverse(world);
    const polygon = corners(box).map((p) =>
      normalized(item.geometry, transformPoint(inverseWorld, p))
    );
    return polygon.some(
      (p, i) =>
        segmentDistance(
          { x: 0, y: 0 },
          p,
          polygon[(i + 1) % polygon.length]!
        ) <= 1
    );
  },
};
