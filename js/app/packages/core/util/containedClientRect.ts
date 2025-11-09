/**
 * Now that blocks are css containers, they reset the fixed positioning context for
 * their children. When we use getBoundingClientRect + fixed on elements inside a block,
 * we get the wrong position. Bounding client rect is relative to the viewport. position: fixed top
 * and bottom are realative to the block container. This function naievely does one layer
 * of offsetParent tracking to get the correct rect
 *  TODO: seamus handled nested containers.
 */

/**
 * From MDN:
 * If the position property is absolute or fixed, the containing block may also be formed by the
 * edge of the padding box of the nearest ancestor element that has any of the following:
 * - A filter, backdrop-filter, transform, or perspective value other than none.
 * - A contain value of layout, paint, strict or content(e.g., contain: paint;).
 * - A container-type value other than normal.
 * - A will-change value containing a property for which a non-initial value would
 *       form a containing block(e.g., filter or transform).
 * - A content-visibility value of auto.
 */
function isFixedPositionReset(element: HTMLElement) {
  const style = window.getComputedStyle(element);
  if (
    style.filter !== 'none' ||
    style.backdropFilter !== 'none' ||
    style.transform !== 'none' ||
    style.perspective !== 'none' ||
    style.contain === 'layout' ||
    style.contain === 'paint' ||
    style.contain === 'strict' ||
    style.containerType !== 'normal' ||
    style.willChange === 'transform' ||
    style.willChange === 'perspective' ||
    style.willChange === 'filter' ||
    style.willChange === 'backdrop-filter' ||
    style.contentVisibility === 'auto'
  ) {
    return true;
  }
  return false;
}

/**
 * If a fixed-position component relies on getBoundingClientRect to determine its position
 * and is mounted inside a block, it will return the wrong position. This function return a
 * compensated rect.
 */
export function containedClientRect(element: HTMLElement) {
  const rect = element.getBoundingClientRect();
  let parent = element.parentElement;
  while (parent) {
    if (isFixedPositionReset(parent)) {
      const parentRect = parent.getBoundingClientRect();
      const x = rect.x - parentRect.left;
      const y = rect.y - parentRect.top;
      const { width, height } = rect;
      return DOMRect.fromRect({ x, y, width, height });
    }
    parent = parent.parentElement;
  }
  return rect;
}

/**
 * Get the closest layout-fixed-breaking parent DOMRect of an element.
 */
export function getContainerRect(element: HTMLElement) {
  let parent = element.parentElement;
  while (parent) {
    if (isFixedPositionReset(parent)) {
      const parentRect = parent.getBoundingClientRect();
      return parentRect;
    }
    parent = parent.parentElement;
  }
  return document.body.getBoundingClientRect();
}
