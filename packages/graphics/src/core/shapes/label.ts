import {
  inverse,
  multiply,
  scaling,
  transformPoint,
  translation,
} from '../affine';
import type { GraphicsItem, Point, ShapeItem } from '../model';
import {
  type BoxGeometry,
  sameBoxGeometry,
  validBoxGeometry,
} from './box-geometry';
import { connectorPath } from './connector-routing';
import { type TextGeometry, type TextMeasurer, textDefinition } from './text';

/** A shape-owned annotation, not an independently selectable scene node. */
export type ShapeLabel = Pick<
  TextGeometry,
  'content' | 'fontSize' | 'fontFamily' | 'height'
> &
  Readonly<{
    /** Measured text width for connectors; box labels use the interior. */
    width?: number;
  }>;
export type LabeledGeometry = BoxGeometry & Readonly<{ label?: ShapeLabel }>;
export type LabelShape = ShapeItem<'rectangle' | 'ellipse' | 'connector'>;
export const canLabel = (item: GraphicsItem | undefined): item is LabelShape =>
  item?.type === 'rectangle' ||
  item?.type === 'ellipse' ||
  item?.type === 'connector';
const innerSize = (item: ShapeItem<'rectangle' | 'ellipse'>) => {
  const ratio = item.type === 'ellipse' ? Math.SQRT1_2 : 1;
  return {
    width: Math.max(1, item.geometry.width * ratio - 24),
    height: Math.max(1, item.geometry.height * ratio - 24),
  };
};
export function labelTextGeometry(
  item: LabelShape,
  label: ShapeLabel
): TextGeometry {
  return {
    ...label,
    autoWidth: false,
    width:
      item.type === 'connector'
        ? (label.width ?? 240)
        : Math.max(label.fontSize * 2, innerSize(item).width),
  };
}
export function measureShapeLabel(
  item: LabelShape,
  label: ShapeLabel,
  measure?: TextMeasurer
): ShapeLabel {
  if (item.type === 'connector') {
    const size = measure?.({
      ...labelTextGeometry(item, label),
      autoWidth: true,
    });
    return {
      ...label,
      width: size?.width ?? label.width ?? 240,
      height: size?.height ?? label.height,
    };
  }
  return {
    ...label,
    height: measure?.(labelTextGeometry(item, label)).height ?? label.height,
  };
}
/** Same local layout feeds rendering, the editing overlay, and painted picking.
 * Small shapes fit the wrapped label uniformly; glyphs are never stretched. */
export function shapeLabelLayout(item: LabelShape) {
  const label = item.geometry.label;
  if (!label) return;
  const geometry = labelTextGeometry(item, label);
  if (item.type === 'connector') {
    const { start, end, route } = item.geometry;
    const points = connectorPath(start, end, route).points;
    const lengths = points
      .slice(1)
      .map((p, i) => Math.hypot(p.x - points[i]!.x, p.y - points[i]!.y));
    let remaining = lengths.reduce((sum, length) => sum + length, 0) / 2;
    let center = start.point;
    for (let i = 0; i < lengths.length; i++) {
      const length = lengths[i]!;
      if (remaining <= length) {
        const a = points[i]!,
          b = points[i + 1]!,
          t = length ? remaining / length : 0;
        center = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
        break;
      }
      remaining -= length;
    }
    return {
      geometry,
      transform: translation(
        center.x - geometry.width / 2,
        center.y - geometry.height / 2
      ),
    };
  }
  const inner = innerSize(item);
  const scale = Math.min(
    1,
    inner.width / geometry.width,
    inner.height / geometry.height
  );
  return {
    geometry,
    transform: multiply(
      translation(
        (item.geometry.width - geometry.width * scale) / 2,
        (item.geometry.height - geometry.height * scale) / 2
      ),
      scaling(scale, scale)
    ),
  };
}
/** An ephemeral text projection lets hosts reuse their text editor. Never persist it. */
export function shapeLabelText(
  item: LabelShape
): ShapeItem<'text'> | undefined {
  const layout = shapeLabelLayout(item);
  if (!layout) return;
  return {
    ...item,
    type: 'text',
    geometry: layout.geometry,
    transform: multiply(item.transform, layout.transform),
    appearance: {
      ...item.appearance,
      stroke:
        item.appearance.stroke === 'transparent'
          ? 'currentColor'
          : item.appearance.stroke,
    },
  };
}
export function hitShapeLabel(item: LabelShape, point: Point): boolean {
  const layout = shapeLabelLayout(item);
  if (!layout) return false;
  const p = transformPoint(inverse(layout.transform), point);
  return (
    p.x >= 0 &&
    p.y >= 0 &&
    p.x <= layout.geometry.width &&
    p.y <= layout.geometry.height
  );
}
export function validShapeLabel(value: unknown): value is ShapeLabel {
  return (
    !!value &&
    typeof value === 'object' &&
    textDefinition.validateGeometry({ width: 1, ...value, autoWidth: false })
  );
}
export function validLabeledGeometry(value: unknown): value is LabeledGeometry {
  return (
    validBoxGeometry(value) &&
    (!('label' in value) ||
      value.label === undefined ||
      validShapeLabel(value.label))
  );
}
export function freezeLabeledGeometry(
  geometry: LabeledGeometry
): LabeledGeometry {
  return Object.freeze({
    ...geometry,
    width: geometry.width,
    height: geometry.height,
    ...(geometry.label
      ? {
          label: Object.freeze({
            ...geometry.label,
            content: geometry.label.content,
          }),
        }
      : {}),
  });
}
export function sameLabeledGeometry(a: LabeledGeometry, b: LabeledGeometry) {
  return sameBoxGeometry(a, b) && JSON.stringify(a) === JSON.stringify(b);
}
export function resizeLabeledShape<
  T extends ShapeItem<'rectangle' | 'ellipse'>,
>(item: T, size: BoxGeometry, measure?: TextMeasurer): T {
  const resized = {
    ...item,
    geometry: { ...item.geometry, width: size.width, height: size.height },
  };
  const label = item.geometry.label;
  return label
    ? {
        ...resized,
        geometry: {
          ...resized.geometry,
          label: measureShapeLabel(resized, label, measure),
        },
      }
    : resized;
}

/** Replace a label while preserving the owner's geometry and discriminant. */
export function withShapeLabel<T extends LabelShape>(
  item: T,
  label?: ShapeLabel
): T {
  const { label: _previous, ...geometry } = item.geometry;
  return { ...item, geometry: { ...geometry, ...(label ? { label } : {}) } };
}
