import type { Matrix } from '../affine';
import type {
  Bounds,
  Point,
  ShapeGeometryMap,
  ShapeItem,
  ShapeKind,
} from '../model';

export type HitTestContext = Readonly<{
  worldTransform: Matrix;
  tolerance: number;
}>;
/** Pure geometry contract. The host owns transforms, transactions and selection. */
export type ShapeDefinition<K extends ShapeKind> = Readonly<{
  type: K;
  label: string;
  validateGeometry(value: unknown): value is ShapeGeometryMap[K];
  createGeometry(bounds: Bounds): ShapeGeometryMap[K];
  bounds(item: ShapeItem<K>): Bounds;
  hitTest(
    item: ShapeItem<K>,
    localPoint: Point,
    context: HitTestContext
  ): boolean;
  intersectsBox(
    item: ShapeItem<K>,
    worldTransform: Matrix,
    box: Bounds
  ): boolean;
  /** Map geometry into the new local bounds; caller moves the local origin. */
  resize(item: ShapeItem<K>, size: Bounds): ShapeItem<K>;
  sameGeometry(a: ShapeItem<K>, b: ShapeItem<K>): boolean;
}>;
