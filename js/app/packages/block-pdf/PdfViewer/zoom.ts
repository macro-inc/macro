/** 25% original size */
export const ZOOM_MIN = 0.25;
/** 250% original size */
export const ZOOM_MAX = 2.5;

const SCALE_DELTA = 1.05;
export const DEFAULT_ZOOM = 1.125;

export function incrementScale(scale: number, steps = 1): number {
  let newScale = scale;
  do {
    newScale = newScale * SCALE_DELTA;
    newScale = Math.ceil(newScale * 10) / 10;
    newScale = Math.min(ZOOM_MAX, newScale);
  } while (--steps > 0 && newScale < ZOOM_MAX);
  return newScale;
}

export function decrementScale(scale: number, steps = 1): number {
  let newScale = scale;
  do {
    newScale = newScale / SCALE_DELTA;
    newScale = Math.floor(newScale * 10) / 10;
    newScale = Math.max(ZOOM_MIN, newScale);
  } while (--steps > 0 && newScale > ZOOM_MIN);
  return newScale;
}

export function isSameScale(a: number, b: number) {
  return a === b || Math.abs(a - b) < 1e-15;
}

export function scaleByScrollTicks(previousScale: number, ticks: number) {
  return ticks < 0
    ? decrementScale(previousScale, -ticks)
    : ticks > 0
      ? incrementScale(previousScale, ticks)
      : previousScale;
}

/**
 *After scaling the page with the mouse wheel, the page does not scroll to the cursor position.
 *The position under the cursor should be restored instead.
 */
export function correctScrollAfterWheelZoom({
  previousScale,
  currentScale,
  container,
  evt,
}: {
  previousScale: number;
  currentScale: number;
  container: HTMLDivElement;
  evt:
    | WheelEvent
    | {
        clientX: number;
        clientY: number;
      };
}) {
  if (previousScale === currentScale) return;
  const scaleCorrectionFactor = currentScale / previousScale;
  const rect = container.getBoundingClientRect();
  const dx = evt.clientX - rect.left;
  const dy = evt.clientY - rect.top;
  container.scrollLeft =
    (dx + container.scrollLeft) * scaleCorrectionFactor - dx;
  container.scrollTop = (dy + container.scrollTop) * scaleCorrectionFactor - dy;
}
