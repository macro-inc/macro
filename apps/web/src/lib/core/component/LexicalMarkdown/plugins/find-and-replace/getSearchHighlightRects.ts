import type { SplitOffset } from './findAndReplacePlugin';

function collectTextNodes(root: Node): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let current = walker.nextNode();
  while (current) {
    nodes.push(current as Text);
    current = walker.nextNode();
  }
  return nodes;
}

export function createRangeFromOffsets(
  element: HTMLElement,
  start: number,
  end: number
): Range | null {
  const textNodes = collectTextNodes(element);
  let accumulated = 0;
  let startNode: Text | undefined;
  let startOffset = 0;
  let endNode: Text | undefined;
  let endOffset = 0;

  for (const node of textNodes) {
    const length = node.data.length;
    if (startNode === undefined && start < accumulated + length) {
      startNode = node;
      startOffset = Math.max(0, start - accumulated);
    }
    if (end <= accumulated + length) {
      endNode = node;
      endOffset = Math.max(0, end - accumulated);
      break;
    }
    accumulated += length;
  }

  if (!startNode || !endNode) return null;

  try {
    const range = document.createRange();
    range.setStart(startNode, startOffset);
    range.setEnd(endNode, endOffset);
    return range;
  } catch {
    return null;
  }
}

export function getSearchHighlightRects(
  element: HTMLElement,
  offset: SplitOffset,
  highlightEntire = false
): DOMRect[] {
  if (!highlightEntire) {
    const range = createRangeFromOffsets(element, offset.start, offset.end);
    if (range) {
      const rects = [...range.getClientRects()].filter(
        (rect) => rect.width > 0 && rect.height > 0
      );
      if (rects.length > 0) return rects;
    }
  }

  const rect = element.getBoundingClientRect();
  if (rect.width > 0 && rect.height > 0) return [rect];
  return [];
}
