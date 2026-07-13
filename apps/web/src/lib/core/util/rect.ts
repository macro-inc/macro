/**
 * Checks if a point (or a centered object point) is inside a DOMRect
 * If width and height are provided, the x,y coordinates are assumed to be the center of the object
 *
 * @param rect - The DOMRect to check
 * @param x - The x coordinate of the point
 * @param y - The y coordinate of the point
 * @param w - Optional width of the element
 * @param h - Optional height of the element
 * @returns True if the element is inside the DOMRect, false otherwise
 */
export const isInDOMRect = (
  rect: DOMRect,
  x: number,
  y: number,
  w?: number,
  h?: number
) => {
  const w_ = w ?? 0;
  const h_ = h ?? 0;
  return (
    x - w_ / 2 >= rect.left &&
    x + w_ / 2 <= rect.right &&
    y - h_ / 2 >= rect.top &&
    y + h_ / 2 <= rect.bottom
  );
};
