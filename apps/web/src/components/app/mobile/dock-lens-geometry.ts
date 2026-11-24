/**
 * Scroll offsets of the dock's tab lens. The lens sits in the scrolled content
 * at a fixed spot, so it appears over the first tab at the end of the scroll
 * range and over the last tab at offset 0: dragging right scrolls back toward
 * 0 and carries the lens right, under the finger.
 *
 * `centers` are the tabs' centres along the bar, ascending, in px.
 */
export function lensOffset(centers: readonly number[], index: number) {
  if (centers.length === 0) return 0;
  return centers[centers.length - 1] - centers[index];
}

/** The tab whose snap point is nearest a scroll offset. */
export function lensIndexAt(centers: readonly number[], offset: number) {
  let nearest = 0;
  for (let index = 1; index < centers.length; index++)
    if (
      Math.abs(lensOffset(centers, index) - offset) <
      Math.abs(lensOffset(centers, nearest) - offset)
    )
      nearest = index;
  return nearest;
}
