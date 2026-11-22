/**
 * The nearest ancestor that scrolls vertically, such as an agent transcript's
 * column. A box that only scrolls sideways (a wide table) or has nothing to
 * scroll does not count: `overflow-x: auto` alone computes `overflow-y` to
 * `auto` too, so the content's height decides.
 */
export function scrollColumn(
  element: Element | undefined
): Element | undefined {
  for (let node = element?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    const scrolls = overflowY === 'auto' || overflowY === 'scroll';
    if (scrolls && node.scrollHeight > node.clientHeight) return node;
  }
  return undefined;
}
