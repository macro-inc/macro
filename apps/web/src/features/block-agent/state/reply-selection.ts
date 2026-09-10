/**
 * Whether a native text selection is a quote-reply candidate: non-empty,
 * non-collapsed, and fully inside the transcript container.
 */

export function normalizeReplySelection(text: string): string | undefined {
  const trimmed = text.replace(/\u00a0/g, ' ').trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function selectionIsInside(
  container: Node | null | undefined,
  range: Range
): boolean {
  if (!container) return false;
  return container.contains(range.commonAncestorContainer);
}

export function readReplyableSelection(
  container: Node | null | undefined
): string | undefined {
  if (!container) return undefined;
  const sel = document.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return undefined;
  const range = sel.getRangeAt(0);
  if (!selectionIsInside(container, range)) return undefined;
  return normalizeReplySelection(sel.toString());
}
