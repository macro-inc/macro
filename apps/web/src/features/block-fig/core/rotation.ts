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
