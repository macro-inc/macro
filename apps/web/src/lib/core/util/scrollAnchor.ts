/**
 * A point in the document whose on-screen position should survive a reflow.
 * `top` is its offset from the scroller's top edge when captured; `measure`
 * reads it again. Measuring from the scroller rather than the viewport keeps
 * the anchor valid when the scroller itself moves, as a split does when the
 * split above it closes.
 */
export type ScrollAnchor = {
  top: number;
  measure: () => number | undefined;
};

function rangeTop(range: Range): number | undefined {
  const rect = range.getClientRects()[0];
  return rect?.top;
}

/** An anchor at viewport offset `top`, measured from the scroller's top edge. */
function relativeTo(
  scroller: HTMLElement,
  view: DOMRect,
  top: number,
  measure: () => number | undefined
): ScrollAnchor {
  return {
    top: top - view.top,
    measure: () => {
      const current = measure();
      return current === undefined
        ? undefined
        : current - scroller.getBoundingClientRect().top;
    },
  };
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
  const anchorAt = (top: number, measure: () => number | undefined) =>
    relativeTo(scroller, view, top, measure);

  const selection = editorRoot.ownerDocument.getSelection();
  if (selection && selection.rangeCount > 0) {
    const range = selection.getRangeAt(0);
    const top = editorRoot.contains(range.startContainer)
      ? rangeTop(range)
      : undefined;
    if (top !== undefined && isOnScreen(top)) {
      return anchorAt(top, () => rangeTop(range));
    }
  }

  const blocks = editorRoot.children;
  for (let i = firstBlockBelow(blocks, view.top); i < blocks.length; i++) {
    const block = blocks[i]!;
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
        if (top !== undefined) return anchorAt(top, () => rangeTop(range));
      }
    }
    return anchorAt(rect.top, () =>
      block.isConnected ? block.getBoundingClientRect().top : undefined
    );
  }
  return undefined;
}

/**
 * The index of the first block whose bottom is below `top`. Blocks are laid
 * out in document order, so a binary search finds it without measuring every
 * block above the viewport, which matters when this runs as the reader scrolls
 * a long document.
 */
function firstBlockBelow(blocks: HTMLCollection, top: number) {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if (blocks[middle]!.getBoundingClientRect().bottom <= top) low = middle + 1;
    else high = middle;
  }
  return low;
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

/**
 * The nearest ancestor that scrolls vertically. When none overflows yet, the
 * nearest one styled to scroll, since the reflow can make it overflow.
 */
function verticalScrollParent(element: Element): HTMLElement | undefined {
  let styled: HTMLElement | undefined;
  for (
    let parent = element.parentElement;
    parent;
    parent = parent.parentElement
  ) {
    if (!/auto|scroll/.test(getComputedStyle(parent).overflowY)) continue;
    if (parent.scrollHeight > parent.clientHeight) return parent;
    styled ??= parent;
  }
  return styled;
}

/**
 * Anchors on `element` when any of it is on screen in the nearest container
 * that scrolls it vertically.
 */
export function captureElementScrollAnchor(
  element: Element | undefined
): { scroller: HTMLElement; anchor: ScrollAnchor } | undefined {
  if (!element?.isConnected) return undefined;
  const scroller = verticalScrollParent(element);
  if (!scroller) return undefined;

  const view = scroller.getBoundingClientRect();
  const { top, bottom } = element.getBoundingClientRect();
  if (bottom < view.top || top > view.bottom) return undefined;

  return {
    scroller,
    anchor: relativeTo(scroller, view, top, () =>
      element.isConnected ? element.getBoundingClientRect().top : undefined
    ),
  };
}

const SCROLL_HOLD_MS = 1000;
const USER_SCROLL_EVENTS = [
  'wheel',
  'touchstart',
  'pointerdown',
  'keydown',
] as const;
const activeHolds = new WeakMap<HTMLElement, () => void>();

/**
 * Keeps the anchor at its captured offset while the scroller's layout settles
 * after a change the caller just made. A width change can reflow content in
 * several passes, as components re-lay out in their own ResizeObservers, so
 * one restore is not enough. Native scroll anchoring is off meanwhile so it
 * cannot shift the page towards a different anchor, and user scroll input
 * ends the hold. A new hold on the same scroller replaces the previous one.
 */
export function holdScrollAnchor(scroller: HTMLElement, anchor: ScrollAnchor) {
  activeHolds.get(scroller)?.();
  const restore = () => restoreScrollAnchor(scroller, anchor);
  const overflowAnchor = scroller.style.overflowAnchor;
  scroller.style.overflowAnchor = 'none';

  const observer = new ResizeObserver(restore);
  observer.observe(scroller);
  for (const child of scroller.children) observer.observe(child);

  const release = () => {
    activeHolds.delete(scroller);
    clearTimeout(timeout);
    observer.disconnect();
    scroller.style.overflowAnchor = overflowAnchor;
    for (const type of USER_SCROLL_EVENTS) {
      scroller.removeEventListener(type, release);
    }
  };
  const timeout = setTimeout(release, SCROLL_HOLD_MS);
  for (const type of USER_SCROLL_EVENTS) {
    scroller.addEventListener(type, release, { passive: true });
  }
  activeHolds.set(scroller, release);

  restore();
}

/**
 * Keeps the reader's place when the scroller changes width. Text rewraps under
 * an unchanged scrollTop when a neighbouring split closes or opens, and WebKit
 * has no CSS scroll anchoring to correct it. Where the browser does anchor,
 * this takes over for width changes, so every engine keeps the same text in
 * view. The anchor is taken as the reader scrolls, and again when the content
 * changes height at the same width (an edit or an image loading above), because
 * by the time a width change is observed the content has already reflowed.
 * A hold already running on the scroller (the clicked element when a new split
 * opens) is left alone. Returns the cleanup.
 */
export function keepScrollAnchorOnResize(
  scroller: HTMLElement,
  capture: () => ScrollAnchor | undefined
): () => void {
  let anchor: ScrollAnchor | undefined;
  let frame: number | undefined;
  let width = scroller.getBoundingClientRect().width;

  const recapture = () => {
    if (frame !== undefined) return;
    frame = requestAnimationFrame(() => {
      frame = undefined;
      anchor = capture();
    });
  };

  const observer = new ResizeObserver(() => {
    const next = scroller.getBoundingClientRect().width;
    // A hidden split measures zero; keep the anchor for when it comes back.
    if (next === 0) return;
    if (next === width) {
      recapture();
      return;
    }
    width = next;
    if (!anchor || scroller.scrollTop === 0 || activeHolds.has(scroller)) {
      return;
    }
    holdScrollAnchor(scroller, anchor);
  });

  scroller.addEventListener('scroll', recapture, { passive: true });
  observer.observe(scroller);
  for (const child of scroller.children) observer.observe(child);

  return () => {
    scroller.removeEventListener('scroll', recapture);
    observer.disconnect();
    if (frame !== undefined) cancelAnimationFrame(frame);
  };
}
