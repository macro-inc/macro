import type { SplitOffset } from './findAndReplacePlugin';

function getDeepestFirstChild(
  htmlEl: ChildNode | null | undefined
): ChildNode | null | undefined {
  if (htmlEl?.firstChild) {
    return getDeepestFirstChild(htmlEl.firstChild);
  }
  return htmlEl;
}

function isMentionAttr(name: string): boolean {
  return name.endsWith('-mention');
}

function mentionRoot(element: HTMLElement): HTMLElement | null {
  if ([...element.attributes].some((attr) => isMentionAttr(attr.name))) {
    return element;
  }
  for (const child of element.querySelectorAll<HTMLElement>('*')) {
    if ([...child.attributes].some((attr) => isMentionAttr(attr.name))) {
      return child;
    }
  }
  return null;
}

export function isMentionElement(element: HTMLElement): boolean {
  return mentionRoot(element) !== null;
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
 * Skill chips render a leading `/` that is not in getTextContent(). User and
 * group mentions already include `@` in searchable text, so do not shift those.
 */
function mentionMatchShift(text: string, offset: SplitOffset): number {
  if (text.startsWith('/') && text.length - 1 >= offset.end) {
    return 1;
  }
  return 0;
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
  const mention = mentionRoot(element);
  if (mention) {
    const shift = mentionMatchShift(mention.textContent ?? '', offset);
    const ranges = rangesFromTextOffsets(
      mention,
      offset.start + shift,
      offset.end + shift
    );
    if (ranges.length > 0) {
      return ranges;
    }
    const range = document.createRange();
    range.selectNode(mention);
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
  if (rects.length === 0 && isMentionElement(element)) {
    const box = element.getBoundingClientRect();
    if (box.width > 0 || box.height > 0) {
      return [box];
    }
  }
  return rects;
}
