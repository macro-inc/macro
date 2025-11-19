import { createMemo, type Accessor } from 'solid-js';

/**
 * Calculate modal position from an anchor element
 * Returns position object with top and left coordinates, or undefined if no anchor
 *
 * @param anchor - Accessor for the anchor HTMLElement (or null/undefined)
 * @returns Position object with top and left coordinates, or undefined
 */
export function useModalPosition(
  anchor: Accessor<HTMLElement | null | undefined>
): Accessor<{ top: number; left: number } | undefined> {
  return createMemo(() => {
    const anchorElement = anchor();
    if (!anchorElement) {
      return undefined;
    }

    const rect = anchorElement.getBoundingClientRect();
    return {
      top: rect.top,
      left: rect.left,
    };
  });
}

