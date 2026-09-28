import type { SplitOffset } from './findAndReplacePlugin';

function getDeepestFirstChild(
  htmlEl: ChildNode | null | undefined
): ChildNode | null | undefined {
  if (htmlEl?.firstChild) {
    return getDeepestFirstChild(htmlEl.firstChild);
  }
  return htmlEl;
}

export function isDocumentMentionElement(element: HTMLElement): boolean {
  return (
    element.hasAttribute('data-document-mention') ||
    element.querySelector('[data-document-mention]') !== null
  );
}

function rangesFromTextOffsets(
  root: Node,
  start: number,
  end: number
): Range[] {
  const ranges: Range[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let cursor = 0;
  let node = walker.nextNode();
  while (node) {
    const text = node.textContent ?? '';
    const nodeStart = cursor;
    const nodeEnd = cursor + text.length;
    const overlapStart = Math.max(start, nodeStart);
    const overlapEnd = Math.min(end, nodeEnd);
    if (overlapStart < overlapEnd) {
      const range = document.createRange();
      range.setStart(node, overlapStart - nodeStart);
      range.setEnd(node, overlapEnd - nodeStart);
      ranges.push(range);
    }
    cursor = nodeEnd;
    if (cursor >= end) break;
    node = walker.nextNode();
  }
  return ranges;
}

/**
 * Map a find-match offset onto DOM ranges. Mention chips are decorator nodes,
 * so character offsets must be applied to the title text inside the pill
 * rather than the first descendant (often an icon).
 */
export function resolveSearchHighlightRanges(
  element: HTMLElement,
  offset: SplitOffset
): Range[] {
  if (isDocumentMentionElement(element)) {
    const nameEl =
      (element.hasAttribute('data-document-name')
        ? element
        : element.querySelector('[data-document-name]')) ?? element;
    const ranges = rangesFromTextOffsets(nameEl, offset.start, offset.end);
    if (ranges.length > 0) {
      return ranges;
    }
    const range = document.createRange();
    range.selectNode(element);
    return [range];
  }

  const htmlEl = getDeepestFirstChild(element.firstChild);
  if (!htmlEl) return [];
  const range = document.createRange();
  try {
    range.setStart(htmlEl, offset.start);
    range.setEnd(htmlEl, offset.end);
    return [range];
  } catch {
    return [];
  }
}

export function getSearchHighlightClientRects(
  element: HTMLElement,
  offset: SplitOffset
): DOMRect[] {
  const ranges = resolveSearchHighlightRanges(element, offset);
  const rects = ranges.flatMap((range) => [...range.getClientRects()]);
  if (rects.length === 0 && isDocumentMentionElement(element)) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 || box.height > 0) {
      return [box];
    }
  }
  return rects;
}
