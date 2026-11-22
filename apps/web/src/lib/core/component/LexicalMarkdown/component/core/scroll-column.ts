/**
 * The nearest ancestor outside the markdown that scrolls vertically, such as
 * an agent transcript's column. The search starts above the editor's root:
 * boxes inside the markdown (a wide table's container, a search hit's root)
 * only scroll sideways, but `overflow-x: auto` alone computes `overflow-y` to
 * `auto` as well, so they would otherwise count.
 */
export function scrollColumn(
  element: Element | undefined
): Element | undefined {
  const start = element?.closest('[data-lexical-editor]') ?? element;
  for (let node = start?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return undefined;
}
