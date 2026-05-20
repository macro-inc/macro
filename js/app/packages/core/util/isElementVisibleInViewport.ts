function matchScroll(str: string) {
  return str.match(/auto|scroll/);
}

const getScrollElementParent = (el: HTMLElement | null) => {
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

export function isElementVisibleInViewport(
  el: HTMLElement,
  options: {
    padding?: {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
  } = {}
): boolean {
  const top = options.padding?.top ?? 0;
  const right = options.padding?.right ?? 0;
  const bottom = options.padding?.bottom ?? 0;
  const left = options.padding?.left ?? 0;

  const rect = el.getBoundingClientRect();

  const visibleWidth =
    Math.min(rect.right, window.innerWidth - right) - Math.max(rect.left, left);

  const visibleHeight =
    Math.min(rect.bottom, window.innerHeight - bottom) -
    Math.max(rect.top, top);

  return visibleWidth >= 0 && visibleHeight >= 0;
}
export function isElementVisibleInScrollElViewport(
  el: HTMLElement,
  options: {
    padding?: {
      top?: number;
      right?: number;
      bottom?: number;
      left?: number;
    };
  } = {}
) {
  const top = options.padding?.top ?? 0;
  const right = options.padding?.right ?? 0;
  const bottom = options.padding?.bottom ?? 0;
  const left = options.padding?.left ?? 0;

  const rect = el.getBoundingClientRect();
  const scrollEl = getScrollElementParent(el);
  if (scrollEl === el) {
    return {
      visibleHeight: 0,
      visibleWidth: 0,
      isHeightClipped: false,
      isWidthClipped: false,
      height: rect.height,
      width: rect.width,
      scrollElRect: null,
      isVisible: true,
    };
  }

  if (!scrollEl) {
    return {
      visibleHeight: 0,
      visibleWidth: 0,
      isHeightClipped: false,
      isWidthClipped: false,
      height: rect.height,
      width: rect.width,
      scrollElRect: null,
      isVisible: true,
    };
  }

  const scrollElRect = scrollEl?.getBoundingClientRect();

  const visibleWidth =
    Math.min(rect.right - scrollElRect.left, scrollElRect.width - right) -
    Math.max(rect.left - scrollElRect.left, left);

  const visibleHeight =
    Math.min(rect.bottom - scrollElRect.top, scrollElRect.height - bottom) -
    Math.max(rect.top - scrollElRect.top, top);

  return {
    isHeightClipped: visibleHeight < rect.height,
    isWidthClipped: visibleWidth < rect.height,
    visibleHeight,
    visibleWidth,
    height: rect.height,
    width: rect.width,
    scrollElRect,
    isVisible: visibleWidth >= 0 && visibleHeight >= 0,
  };
}
