import type { Matrix } from './affine';
import type { SortKey } from './ordering';
import type { ConnectorGeometry } from './shapes/connector';
import type { EllipseGeometry } from './shapes/ellipse';
import type { DocumentGeometry, MediaGeometry } from './shapes/embedded';
import type { PencilGeometry } from './shapes/pencil';
import type { RectangleGeometry } from './shapes/rectangle';
import type { TextGeometry } from './shapes/text';

export type Point = Readonly<{ x: number; y: number }>;
export type Camera = Readonly<{ x: number; y: number; scale: number }>;
export type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type Placement = Readonly<{ parentId: string; sortKey: SortKey }>;
type SpatialNode = Readonly<{
  id: string;
  placement: Placement;
  transform: Matrix;
}>;
/** Compile-time composition point; no declaration merging or global mutation. */
export type ShapeGeometryMap = {
  connector: ConnectorGeometry;
  rectangle: RectangleGeometry;
  ellipse: EllipseGeometry;
  pencil: PencilGeometry;
  text: TextGeometry;
  image: MediaGeometry;
  video: MediaGeometry;
  document: DocumentGeometry;
};
export type ShapeKind = keyof ShapeGeometryMap;
export type Appearance = Readonly<{
  fill: string;
  stroke: string;
  strokeWidth?: number;
  strokeStyle?: 'solid' | 'dashed' | 'dotted';
  opacity?: number;
  cornerRadius?: number;
}>;
export type ShapeItem<K extends ShapeKind = ShapeKind> = {
  [P in K]: SpatialNode &
    Readonly<{
      type: P;
      geometry: ShapeGeometryMap[P];
      appearance: Appearance;
    }>;
}[K];
export type RectangleItem = ShapeItem<'rectangle'>;
export type EllipseItem = ShapeItem<'ellipse'>;
export type PencilItem = ShapeItem<'pencil'>;
export type GroupItem = SpatialNode & Readonly<{ type: 'group' }>;
export type SurfaceItem = Readonly<{ id: string; type: 'surface' }>;
export type GraphicsItem = ShapeItem | GroupItem | SurfaceItem;
export type ImageSurface = Readonly<{
  id: string;
  width: number;
  height: number;
}>;
export type GraphicsDocument = Readonly<{
  rootId: string;
  items: Readonly<Record<string, GraphicsItem>>;
  surface?: ImageSurface;
}>;
