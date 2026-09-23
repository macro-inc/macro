import type { Matrix } from './affine';

export type Point = Readonly<{ x: number; y: number }>;
export type Camera = Readonly<{ x: number; y: number; scale: number }>;
export type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;
export type Placement = Readonly<{ parentId: string; order: number }>;
type SpatialNode = Readonly<{
  id: string;
  placement: Placement;
  transform: Matrix;
}>;
export type RectangleItem = SpatialNode &
  Readonly<{
    type: 'rectangle';
    geometry: Readonly<{ width: number; height: number }>;
    appearance: Readonly<{ fill: string; stroke: string }>;
  }>;
export type GroupItem = SpatialNode & Readonly<{ type: 'group' }>;
export type SurfaceItem = Readonly<{ id: string; type: 'surface' }>;
export type GraphicsItem = RectangleItem | GroupItem | SurfaceItem;
export type ImageSurface = Readonly<{
  id: string;
  width: number;
  height: number;
}>;
export type GraphicsDocument = Readonly<{
  version: 2;
  rootId: string;
  items: Readonly<Record<string, GraphicsItem>>;
  surface?: ImageSurface;
}>;
/** Input-only migration boundary for the initial flat prototype. */
export type LegacyRectangle = Readonly<{
  id: string;
  type: 'rectangle';
  geometry: Bounds;
  appearance: RectangleItem['appearance'];
}>;
export type ItemDefinition<T extends RectangleItem> = {
  type: T['type'];
  bounds(item: T): Bounds;
  hitTest(item: T, point: Point): boolean;
};
export const rectangleDefinition: ItemDefinition<RectangleItem> = {
  type: 'rectangle',
  bounds: (item) => ({ x: 0, y: 0, ...item.geometry }),
  hitTest: (item, p) =>
    p.x >= 0 &&
    p.y >= 0 &&
    p.x <= item.geometry.width &&
    p.y <= item.geometry.height,
};
