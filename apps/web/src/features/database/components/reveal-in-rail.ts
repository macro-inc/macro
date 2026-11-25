type HorizontalEdges = { left: number; right: number };

/**
 * How far a horizontal rail scrolls to bring a tab fully into view: negative
 * to the left, 0 when the tab already shows. A tab wider than the rail lines
 * up with the rail's left edge.
 */
export function railScrollToReveal(
  rail: HorizontalEdges,
  tab: HorizontalEdges
): number {
  if (tab.left < rail.left) return tab.left - rail.left;

  if (tab.right > rail.right) {
    const toRightEdge = tab.right - rail.right;
    const toLeftEdge = tab.left - rail.left;
    return Math.min(toRightEdge, toLeftEdge);
  }

  return 0;
}

/** Scroll a tab rail just far enough to show one of its tabs whole. */
export function revealInRail(rail: HTMLElement, tab: HTMLElement) {
  rail.scrollLeft += railScrollToReveal(
    rail.getBoundingClientRect(),
    tab.getBoundingClientRect()
  );
}
