/**
 * Parse a loose width/height value and scale it to fit within constraints.
 * Returns undefined when dimensions are missing or invalid.
 */
export function constrainImageDimensions(
  width: string | number | undefined,
  height: string | number | undefined,
  maxWidth?: number,
  maxHeight?: number
): { width: number; height: number } | undefined {
  const w = typeof width === 'string' ? Number.parseInt(width, 10) : width;
  const h = typeof height === 'string' ? Number.parseInt(height, 10) : height;
  if (!w || !h || w <= 0 || h <= 0) return undefined;
  return calculateEffectiveDimensions(w, h, maxWidth, maxHeight);
}

/**
 * Calculates the effective dimensions based on constrained width and height.
 * Uses the more constrained dimension to maintain aspect ratio.
 */
export function calculateEffectiveDimensions(
  width: number,
  height: number,
  constrainedWidth?: number,
  constrainedHeight?: number
): { width: number; height: number } {
  if (!constrainedWidth && !constrainedHeight) {
    return { width, height };
  }

  if (width <= 0 || height <= 0) {
    return { width, height };
  }

  const widthScale = constrainedWidth ? constrainedWidth / width : Infinity;
  const heightScale = constrainedHeight ? constrainedHeight / height : Infinity;
  const effectiveScale = Math.min(widthScale, heightScale);

  if (effectiveScale === Infinity || effectiveScale >= 1) {
    return { width, height };
  }

  return {
    width: Math.round(width * effectiveScale),
    height: Math.round(height * effectiveScale),
  };
}
