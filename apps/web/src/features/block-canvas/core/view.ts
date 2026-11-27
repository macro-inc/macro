export type CanvasView = {
  x: number;
  y: number;
  scale: number;
};

/**
 * A link's request to select and frame one item. Each navigation makes a new
 * request, so following the same link again frames the item again.
 */
export type CanvasFocusRequest = { itemId: string };
