export interface ComposerDragPoint {
  x: number;
  y: number;
}

export interface ComposerDragBounds {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Match the dock's 384px/45% allocation without resizing the grid during a drag. */
export function composerPinTarget(
  bounds: ComposerDragBounds
): ComposerDragBounds {
  const width = Math.min(384, bounds.width * 0.45);
  return {
    left: bounds.left,
    top: bounds.top,
    width,
    height: bounds.height,
  };
}

export function clampComposerPosition(
  position: ComposerDragPoint,
  surface: ComposerDragBounds,
  boundary: ComposerDragBounds
): ComposerDragPoint {
  const left = boundary.left + 8;
  const top = boundary.top + 8;
  const right = Math.max(
    left,
    boundary.left + boundary.width - surface.width - 8
  );
  const bottom = Math.max(
    top,
    boundary.top + boundary.height - surface.height - 8
  );
  return {
    x: Math.min(right, Math.max(left, position.x)),
    y: Math.min(bottom, Math.max(top, position.y)),
  };
}
