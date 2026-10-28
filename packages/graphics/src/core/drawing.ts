import { translation } from './affine';
import type {
  Appearance,
  Bounds,
  ImageSurface,
  Placement,
  Point,
  ShapeItem,
  ShapeKind,
} from './model';
import { boxGeometry } from './shapes/box-geometry';
import {
  MAX_PENCIL_POINTS,
  type PencilPoint,
  pencilDefinition,
} from './shapes/pencil';

/** Browser-independent input; absent pressure selects mouse pressure simulation. */
export type DrawingKind = Extract<
  ShapeKind,
  'rectangle' | 'ellipse' | 'pencil'
>;
export type DrawingSample = Point & Readonly<{ pressure?: number }>;
export type DrawingModifiers = Readonly<{ proportional?: boolean }>;
type Gesture = {
  origin: Point;
  surface?: ImageSurface;
} & (
  | { kind: 'rectangle' | 'ellipse'; end: Point; proportional: boolean }
  | { kind: 'pencil'; points: PencilPoint[]; simulatePressure: boolean }
);

/** Drawing tools own acquisition; shape definitions own finalized geometry. */
export function createDrawing() {
  let gesture: Gesture | undefined;
  let kind: DrawingKind = 'rectangle';
  const pressure = (value?: number) =>
    Number.isFinite(value) ? Math.max(0, Math.min(1, value!)) : 0.5;
  function update(
    samples: readonly DrawingSample[],
    modifiers: DrawingModifiers = {}
  ) {
    if (!gesture) return;
    if (gesture.kind !== 'pencil')
      gesture.proportional = !!modifiers.proportional;
    for (const sample of samples) {
      if (![sample.x, sample.y].every(Number.isFinite)) continue;
      if (gesture.kind !== 'pencil') {
        gesture.end = { x: sample.x, y: sample.y };
        continue;
      }
      const point: PencilPoint = [
        sample.x - gesture.origin.x,
        sample.y - gesture.origin.y,
        pressure(sample.pressure),
      ];
      const last = gesture.points[gesture.points.length - 1]!;
      if (point[0] === last[0] && point[1] === last[1]) continue;
      if (gesture.points.length < MAX_PENCIL_POINTS) gesture.points.push(point);
    }
  }
  function bounds(): Bounds | undefined {
    if (!gesture) return;
    const { origin } = gesture;
    if (gesture.kind === 'pencil') {
      const xs = gesture.points.map((p) => p[0]),
        ys = gesture.points.map((p) => p[1]);
      const x = Math.min(...xs),
        y = Math.min(...ys);
      return {
        x: origin.x + x,
        y: origin.y + y,
        width: Math.max(...xs) - x,
        height: Math.max(...ys) - y,
      };
    }
    let dx = gesture.end.x - origin.x,
      dy = gesture.end.y - origin.y;
    if (gesture.proportional) {
      const surface = gesture.surface;
      const size = Math.min(
        Math.max(Math.abs(dx), Math.abs(dy)),
        surface ? (dx < 0 ? origin.x : surface.width - origin.x) : Infinity,
        surface ? (dy < 0 ? origin.y : surface.height - origin.y) : Infinity
      );
      dx = (dx < 0 ? -1 : 1) * size;
      dy = (dy < 0 ? -1 : 1) * size;
    }
    return {
      x: origin.x + Math.min(0, dx),
      y: origin.y + Math.min(0, dy),
      width: Math.abs(dx),
      height: Math.abs(dy),
    };
  }
  return {
    begin(next: DrawingKind, sample: DrawingSample, surface?: ImageSurface) {
      kind = next;
      const origin = { x: sample.x, y: sample.y };
      gesture =
        next === 'pencil'
          ? {
              kind: next,
              origin,
              points: [[0, 0, pressure(sample.pressure)]],
              simulatePressure: sample.pressure === undefined,
            }
          : { kind: next, origin, end: origin, proportional: false, surface };
    },
    update,
    bounds,
    kind: () => kind,
    cancel: () => {
      gesture = undefined;
    },
    item(
      id: string,
      placement: Placement,
      appearance: Appearance,
      minSize = 0
    ): ShapeItem | undefined {
      const box = bounds();
      if (!gesture || !box) return;
      const common = { id, placement, appearance };
      if (gesture.kind === 'pencil')
        return {
          ...common,
          type: 'pencil',
          transform: translation(gesture.origin.x, gesture.origin.y),
          geometry: pencilDefinition.freezeGeometry({
            points: gesture.points,
            simulatePressure: gesture.simulatePressure,
          }),
        };
      if (box.width <= minSize || box.height <= minSize) return;
      return {
        ...common,
        type: gesture.kind,
        transform: translation(box.x, box.y),
        geometry: boxGeometry(box),
      };
    },
  };
}
