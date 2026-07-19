const DEFAULT_ITEM_SIZE_ESTIMATE = 40;

/**
 * Keeps Virtua's automatic measured-size estimator enabled when callers do not
 * provide a fixed row size, while retaining row-based overscan semantics.
 */
export function resolveSoupVirtualizerSizing(
  itemSize: number | undefined,
  overscan: number
) {
  return {
    itemSize,
    bufferSize: overscan * (itemSize ?? DEFAULT_ITEM_SIZE_ESTIMATE),
  };
}
