import { corners, intersects, transformPoint } from '../affine';
import type { Bounds } from '../model';
import { type RichText, validRichText } from '../rich-text';
import { validBoxGeometry } from './box-geometry';
import type { ShapeDefinition } from './definition';
export type TextFont = 'sans' | 'serif' | 'mono';
export type TextGeometry = Readonly<{
  width: number;
  height: number;
  autoWidth: boolean;
  fontSize: number;
  fontFamily: TextFont;
  content: RichText;
}>;
/** The host measures with its actual fonts; the core never calls browser layout. */
export type TextMeasurer = (
  geometry: TextGeometry
) => Pick<Bounds, 'width' | 'height'>;
export const textDefinition: ShapeDefinition<'text'> = {
  type: 'text',
  label: 'Text',
  canDeform: false,
  validateGeometry(value): value is TextGeometry {
    if (!validBoxGeometry(value)) return false;
    const v = value as Record<string, unknown>;
    return (
      typeof v.autoWidth === 'boolean' &&
      typeof v.fontSize === 'number' &&
      Number.isFinite(v.fontSize) &&
      v.fontSize > 0 &&
      v.fontSize <= 10000 &&
      ['sans', 'serif', 'mono'].includes(String(v.fontFamily)) &&
      validRichText(v.content)
    );
  },
  freezeGeometry: (geometry) => Object.freeze({ ...geometry }),
  bounds: (item) => ({
    x: 0,
    y: 0,
    width: item.geometry.width,
    height: item.geometry.height,
  }),
  sameGeometry: (a, b) =>
    JSON.stringify(a.geometry) === JSON.stringify(b.geometry),
  hitTest: (item, p) =>
    (item.appearance.opacity ?? 1) > 0 &&
    p.x >= 0 &&
    p.y >= 0 &&
    p.x <= item.geometry.width &&
    p.y <= item.geometry.height,
  intersectsBox: (item, world, box) =>
    intersects(
      corners(textDefinition.bounds(item)).map((p) => transformPoint(world, p)),
      corners(box)
    ),
  resize: (item, size, context) => {
    const reflow = context?.handle === 'e' || context?.handle === 'w';
    const geometry: TextGeometry = {
      ...item.geometry,
      width: Math.max(1, size.width),
      height: Math.max(1, size.height),
      autoWidth: reflow ? false : item.geometry.autoWidth,
      fontSize: reflow
        ? item.geometry.fontSize
        : Math.max(
            0.1,
            Math.min(
              10000,
              (item.geometry.fontSize * size.height) / item.geometry.height
            )
          ),
    };
    return {
      ...item,
      // Corner scaling preserves the layout; remeasuring at fractional font
      // sizes can change wrapping and make the dragged corner jump. Only a
      // width edit needs new layout from the host.
      geometry: reflow
        ? { ...geometry, ...context?.measureText?.(geometry) }
        : geometry,
    };
  },
};
