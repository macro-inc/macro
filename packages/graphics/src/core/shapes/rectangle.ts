import { corners, intersects, transformPoint } from '../affine';
import { resolveAppearance } from '../appearance';
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

export type RectangleGeometry = LabeledGeometry;
export const rectangleDefinition: ShapeDefinition<'rectangle'> = {
  type: 'rectangle',
  label: 'Rectangle',
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
  hitTest: (item, p, { worldTransform, tolerance }) => {
    const style = resolveAppearance(item.appearance);
    if (style.opacity === 0) return false;
    if (hitShapeLabel(item, p)) return true;
    const { width, height } = item.geometry;
    const radius = Math.min(style.cornerRadius, width / 2, height / 2);
    const dx = Math.abs(p.x - width / 2) - width / 2 + radius;
    const dy = Math.abs(p.y - height / 2) - height / 2 + radius;
    const distance =
      Math.hypot(Math.max(dx, 0), Math.max(dy, 0)) +
      Math.min(Math.max(dx, dy), 0) -
      radius;
    if (style.fill !== 'transparent' && distance <= 0) return true;
    if (style.stroke === 'transparent' || style.strokeWidth === 0) return false;
    if (Math.abs(distance) <= style.strokeWidth / 2) return true;
    const point = transformPoint(worldTransform, p);
    const outline =
      radius === 0
        ? corners(rectangleDefinition.bounds(item)).map((p) =>
            transformPoint(worldTransform, p)
          )
        : Array.from({ length: 260 }, (_, i) => {
            const corner = Math.floor(i / 65),
              angle =
                -Math.PI / 2 +
                (corner * Math.PI) / 2 +
                (((i % 65) / 64) * Math.PI) / 2;
            return transformPoint(worldTransform, {
              x:
                (corner < 2 ? width - radius : radius) +
                radius * Math.cos(angle),
              y:
                (corner === 0 || corner === 3 ? radius : height - radius) +
                radius * Math.sin(angle),
            });
          });
    return outline.some(
      (start, i) =>
        segmentDistance(point, start, outline[(i + 1) % outline.length]!) <=
        tolerance
    );
  },
  intersectsBox: (item, world, box) =>
    intersects(
      corners(rectangleDefinition.bounds(item)).map((p) =>
        transformPoint(world, p)
      ),
      corners(box)
    ),
};
