import type { Matrix } from '../affine';
import type {
  Bounds,
  Point,
  ShapeGeometryMap,
  ShapeItem,
  ShapeKind,
} from '../model';
import type { ResizeHandle } from '../resize';
import type { TextMeasurer } from './text';

export type HitTestContext = Readonly<{
  worldTransform: Matrix;
  tolerance: number;
}>;
/** Pure geometry contract. The host owns transforms, transactions and selection. */
export type ShapeDefinition<K extends ShapeKind> = Readonly<{
  type: K;
  label: string;
  /** False keeps mixed selections uniform, preserving typographic proportions. */
  canDeform?: boolean;
  /** Regenerate ink instead of magnifying its brush during group scaling. */
  regenerateOnScale?: boolean;
  validateGeometry(value: unknown): value is ShapeGeometryMap[K];
  freezeGeometry(geometry: ShapeGeometryMap[K]): ShapeGeometryMap[K];
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
  /** Resize about the local origin. The caller supplies positive bounds sizes
   * and handles translation/reflection. Brush-based shapes regenerate their ink. */
  resize(
    item: ShapeItem<K>,
    size: Bounds,
    context?: { handle?: ResizeHandle; measureText?: TextMeasurer }
  ): ShapeItem<K>;
  sameGeometry(a: ShapeItem<K>, b: ShapeItem<K>): boolean;
}>;
