export type Point = Readonly<{ x: number; y: number }>;

/** Camera translation is measured in viewport pixels; item geometry is in world units. */
export type Camera = Readonly<{ x: number; y: number; scale: number }>;
export type Bounds = Readonly<{
  x: number;
  y: number;
  width: number;
  height: number;
}>;

export type RectangleItem = Readonly<{
  id: string;
  type: 'rectangle';
  geometry: Bounds;
  appearance: Readonly<{ fill: string; stroke: string }>;
}>;

export type GraphicsItem = RectangleItem;
/** Image pixels define world coordinates. Image resources are owned by the host. */
export type ImageSurface = Readonly<{
  id: string;
  width: number;
  height: number;
}>;
export type GraphicsDocument = Readonly<{
  version: 1;
  items: Readonly<Record<string, GraphicsItem>>;
  order: readonly string[];
  surface?: ImageSurface;
}>;

export type ItemDefinition<T extends GraphicsItem> = {
  type: T['type'];
  bounds(item: T): Bounds;
  hitTest(item: T, point: Point): boolean;
};

export const rectangleDefinition: ItemDefinition<RectangleItem> = {
  type: 'rectangle',
  bounds: (item) => item.geometry,
  hitTest: ({ geometry: r }, p) =>
    p.x >= r.x && p.y >= r.y && p.x <= r.x + r.width && p.y <= r.y + r.height,
};
