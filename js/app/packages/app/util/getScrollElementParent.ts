function matchScroll(str: string) {
  return str.match(/auto|scroll/);
}

export const getScrollElementParent = (el: HTMLElement | null): HTMLElement | null => {
  if (!el) {
    return null;
  }

  const style = getComputedStyle(el);

  const hasScrollableOverflow =
    matchScroll(style.overflow) ||
    matchScroll(style.overflowY) ||
    matchScroll(style.overflowX);

  if (hasScrollableOverflow && el.clientHeight !== el.scrollHeight) {
    return el;
  }

  return getScrollElementParent(el.parentElement);
};
