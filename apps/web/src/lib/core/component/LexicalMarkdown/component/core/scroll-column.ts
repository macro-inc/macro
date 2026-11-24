import {
  type Boundary,
  flip,
  hide,
  type Middleware,
  type MiddlewareState,
  offset,
  shift,
} from '@floating-ui/dom';
import { iosSafePadding } from '../../directive/iosFloatingMiddleware';

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

/**
 * Positioning for a link's preview card, kept inside the link's scroll
 * column. The boundary is found from the reference element at each update,
 * so it never depends on the link having been attached when the options
 * were built.
 */
export function previewCardMiddleware(spacing: number): Middleware[] {
  const boundary = (state: MiddlewareState): Boundary => {
    const reference = state.elements.reference;
    return (
      (reference instanceof Element ? scrollColumn(reference) : undefined) ??
      'clippingAncestors'
    );
  };
  return [
    offset(spacing),
    flip((state) => ({
      padding: iosSafePadding(spacing),
      boundary: boundary(state),
    })),
    shift((state) => ({ padding: spacing, boundary: boundary(state) })),
    hide(),
  ];
}
