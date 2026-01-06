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
