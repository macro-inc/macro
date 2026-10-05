/** Rotating a layer by dragging beyond a corner of its selection box. */

/** Degrees as Figma shows them (counter-clockwise), snapped with ⇧. */
export function rotationFor(
  startRotation: number,
  startAngle: number,
  angle: number,
  snap: boolean
): number {
  // Screen angles grow clockwise (y points down).
  let r = startRotation - ((angle - startAngle) * 180) / Math.PI;
  r = ((((r + 180) % 360) + 360) % 360) - 180;
  if (snap) r = Math.round(r / 15) * 15;
  return Math.round(r * 100) / 100;
}

const isHalfTurn = (rotation: number) =>
  Math.abs(Math.abs(rotation) - 180) < 0.01;

/**
 * Whether a layer at `rotation` (as the panel shows it) lies along the
 * page's axes, so its selection box is the layer itself: unrotated, or
 * turned half way (which is also how a vertically flipped layer reads).
 */
export function isAxisAligned(rotation: number): boolean {
  return Math.abs(rotation) < 0.01 || isHalfTurn(rotation);
}

type Box = { x: number; y: number; w: number; h: number };

/**
 * The panel X and Y of an axis-aligned layer whose page bounds `from`
 * become `to`: the panel point is the top left corner, or the bottom right
 * one when the layer is turned half way.
 */
export function resizedOrigin(
  info: { x: number; y: number; rotation: number },
  from: Box,
  to: Box
): { x: number; y: number } {
  if (isHalfTurn(info.rotation))
    return {
      x: info.x + (to.x + to.w - (from.x + from.w)),
      y: info.y + (to.y + to.h - (from.y + from.h)),
    };
  return { x: info.x + (to.x - from.x), y: info.y + (to.y - from.y) };
}
