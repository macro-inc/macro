/**
 * A point in the document whose on-screen position should survive a reflow.
 * `top` is its viewport offset when captured; `measure` reads it again.
 */
export type ScrollAnchor = {
  top: number;
  measure: () => number | undefined;
};

function rangeTop(range: Range): number | undefined {
  const rect = range.getClientRects()[0];
  return rect?.top;
}

function caretRangeAt(doc: Document, x: number, y: number): Range | undefined {
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position) {
    const range = doc.createRange();
    range.setStart(position.offsetNode, position.offset);
    return range;
  }
  return doc.caretRangeFromPoint?.(x, y) ?? undefined;
}

/**
 * Captures the point the reader is looking at: the editor selection when it is
 * on screen, otherwise the first editor text that reaches into the viewport.
 */
export function captureScrollAnchor(
  scroller: HTMLElement,
  editorRoot: HTMLElement
): ScrollAnchor | undefined {
  const view = scroller.getBoundingClientRect();
  const isOnScreen = (top: number) => top >= view.top && top <= view.bottom;

  const selection = editorRoot.ownerDocument.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const top = editorRoot.contains(range.startContainer)
      ? rangeTop(range)
      : undefined;
    if (top !== undefined && isOnScreen(top)) {
      return { top, measure: () => rangeTop(range) };
    }
  }

  for (const block of editorRoot.children) {
    const rect = block.getBoundingClientRect();
    if (rect.bottom <= view.top) continue;
    if (rect.top >= view.bottom) return undefined;
    // A block that starts above the viewport rewraps above it too, so anchor
    // the text at the viewport's top edge rather than the block's top.
    if (rect.top < view.top) {
      const range = caretRangeAt(
        editorRoot.ownerDocument,
        rect.left + 1,
        view.top + 1
      );
      if (range && block.contains(range.startContainer)) {
        const top = rangeTop(range);
        if (top !== undefined) return { top, measure: () => rangeTop(range) };
      }
    }
    return {
      top: rect.top,
      measure: () =>
        block.isConnected ? block.getBoundingClientRect().top : undefined,
    };
  }
  return undefined;
}

/** Scrolls so the anchor is back at the viewport offset it was captured at. */
export function restoreScrollAnchor(
  scroller: HTMLElement,
  anchor: ScrollAnchor
) {
  const top = anchor.measure();
  if (top === undefined) return;
  scroller.scrollTop += top - anchor.top;
}
