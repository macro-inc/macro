function matchScroll(str: string) {
  return /(auto|scroll)/.test(str);
}

/**
 * Return the first likely-to-be-scrollable parent of an element. For attaching
 * targeted scroll listeners without explicit ref passing.
 */
export function getScrollParent(
  el: Element | null | undefined
): Element | Document | null {
  if (!el) return window.document ?? null;

  const style = getComputedStyle(el);

  const hasScrollableOverflow =
    matchScroll(style.overflow) ||
    matchScroll(style.overflowY) ||
    matchScroll(style.overflowX);

  if (hasScrollableOverflow) {
    return el;
  }

  return getScrollParent(el.parentElement);
}

/**
 * Return the first likely-to-be-scrollable parent element, or null if none found.
 * Unlike getScrollParent, this never returns the window object.
 */
export function getScrollParentElement(
  el: HTMLElement | null
): HTMLElement | null {
  if (!el) {
    return null;
  }

  const style = getComputedStyle(el);

  const hasScrollableOverflow =
    matchScroll(style.overflow) ||
    matchScroll(style.overflowY) ||
    matchScroll(style.overflowX);

  if (hasScrollableOverflow) {
    return el;
  }

  return getScrollParentElement(el.parentElement);
}
