export type Rect = { x: number; y: number; width: number; height: number };

/** What to copy from the frame's canvas, and where it lands in the snapshot. */
export type SnapshotCopy = {
  source: Rect;
  /** Offset of the copied pixels inside a snapshot of the requested size. */
  offsetX: number;
  offsetY: number;
};

/**
 * Clips a requested region (which the loupe centres on the finger, so it runs
 * off the canvas near an edge) to the canvas. WebKit's drawImage and
 * createImageBitmap reject or draw nothing for a source rect that leaves the
 * image, so only the overlap is ever copied; `undefined` when there is none.
 */
export function snapshotCopy(
  canvas: { width: number; height: number },
  requested: Rect
): SnapshotCopy | undefined {
  const left = Math.max(0, Math.floor(requested.x));
  const top = Math.max(0, Math.floor(requested.y));
  const right = Math.min(
    canvas.width,
    Math.floor(requested.x + requested.width)
  );
  const bottom = Math.min(
    canvas.height,
    Math.floor(requested.y + requested.height)
  );
  if (right <= left || bottom <= top) return undefined;
  return {
    source: { x: left, y: top, width: right - left, height: bottom - top },
    offsetX: left - Math.floor(requested.x),
    offsetY: top - Math.floor(requested.y),
  };
}
