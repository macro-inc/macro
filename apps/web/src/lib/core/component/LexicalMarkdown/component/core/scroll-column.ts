/** A rendered markdown root: a Lexical editor's, or static markdown's. */
const MARKDOWN_ROOT = '[data-lexical-editor], .markdown-content';

/**
 * The nearest ancestor outside the markdown that scrolls vertically, such as
 * an agent transcript's column. The search starts above the outermost
 * markdown root: boxes inside the markdown (a wide table's container, a
 * search hit's root) only mean to scroll sideways, but `overflow-x: auto`
 * alone computes `overflow-y` to `auto` as well, so they would otherwise
 * count.
 */
export function scrollColumn(
  element: Element | undefined
): Element | undefined {
  let start = element;
  for (let node = element?.closest(MARKDOWN_ROOT); node; ) {
    start = node;
    node = node.parentElement?.closest(MARKDOWN_ROOT) ?? null;
  }
  for (let node = start?.parentElement; node; node = node.parentElement) {
    const { overflowY } = getComputedStyle(node);
    if (overflowY === 'auto' || overflowY === 'scroll') return node;
  }
  return undefined;
}
