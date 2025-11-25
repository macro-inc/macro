export function getClippedOverlayRect(
  targetEl: HTMLElement,
  targetElScrollParent: HTMLElement | null
) {
  const targetRect = targetEl.getBoundingClientRect();
  if (!targetElScrollParent) {
    return {
      rect: {
        left: targetRect.left,
        top: targetRect.top,
        right: targetRect.right,
        bottom: targetRect.bottom,
        width: targetRect.width,
        height: targetRect.height,
      },
      isClippedLeft: false,
      isClippedRight: false,
      isClippedTop: false,
      isClippedBottom: false,
      isFullyClipped: false,
      isPartiallyClipped: false,
    };
  }
  const scrollParentRect = targetElScrollParent.getBoundingClientRect();

  // Calculate clipping edges
  const clippedLeft = Math.max(targetRect.left, scrollParentRect.left);
  const clippedTop = Math.max(targetRect.top, scrollParentRect.top);
  const clippedRight = Math.min(targetRect.right, scrollParentRect.right);
  const clippedBottom = Math.min(targetRect.bottom, scrollParentRect.bottom);

  const clippedWidth = Math.max(0, clippedRight - clippedLeft);
  const clippedHeight = Math.max(0, clippedBottom - clippedTop);

  return {
    rect: {
      left: clippedLeft,
      top: clippedTop,
      width: clippedWidth,
      height: clippedHeight,
      right: clippedLeft + clippedWidth,
      bottom: clippedTop + clippedHeight,
    },
    isClippedLeft: clippedLeft > targetRect.left,
    isClippedRight: clippedRight < targetRect.right,
    isClippedTop: clippedTop > targetRect.top,
    isClippedBottom: clippedBottom < targetRect.bottom,
    isFullyClipped: clippedWidth === 0 || clippedHeight === 0,
    isPartiallyClipped:
      clippedLeft > targetRect.left ||
      clippedRight < targetRect.right ||
      clippedTop > targetRect.top ||
      clippedBottom < targetRect.bottom,
  };
}
