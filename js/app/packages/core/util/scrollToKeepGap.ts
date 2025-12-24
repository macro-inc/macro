type AlignMode = 'top' | 'bottom';

/**
 * Conditionally scrolls the container to align the target element
 * near either the container's top or bottom based on the align parameter.
 *
 * @param container - The scrollable container
 * @param target - The element to bring into view
 * @param threshold - Distance from the viewport edge within which to trigger scroll
 * @param gap - Desired distance from the aligned edge after scrolling
 * @param align - "top" or "bottom" (default: "bottom")
 */
export function scrollToKeepGap({
  container,
  target,
  threshold,
  gap,
  align = 'bottom',
}: {
  container: Element;
  target: Element;
  threshold?: number; // px distance from edge to trigger scroll
  gap?: number; // px distance from edge after scrolling
  align?: AlignMode; // "top" | "bottom"
}) {
  const containerRect = container.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();

  // Relative positions (in container scroll coordinates)
  const targetTop = targetRect.top - containerRect.top + container.scrollTop;
  const targetBottom =
    targetRect.bottom - containerRect.top + container.scrollTop;

  gap = gap ?? targetRect.height ?? 50;
  threshold = threshold ?? targetRect.height ?? 50;

  if (align === 'bottom') {
    const containerHeight = containerRect.height;
    const containerBottom = container.scrollTop + containerHeight;
    const distanceToBottom = containerBottom - targetBottom;

    if (distanceToBottom <= threshold) {
      const newScrollTop = targetBottom - containerHeight + gap;
      container.scrollTo({ top: newScrollTop, behavior: 'auto' });
    }
  } else {
    const distanceToTop = targetTop - container.scrollTop;

    if (distanceToTop <= threshold) {
      const newScrollTop = targetTop - gap;
      container.scrollTo({ top: newScrollTop, behavior: 'auto' });
    }
  }
}
