import { formatRelativeDay, parseMentionDate } from '@core/util/dateParser';
import {
  type CellMention,
  cellMentionLabel,
  cellTextParts,
} from '@macro-inc/spreadsheet/cell-mentions';

/** Match the grid, where date chips relabel themselves as days pass. */
function pillLabel(mention: CellMention) {
  return mention.type === 'date'
    ? formatRelativeDay(parseMentionDate(mention.date))
    : cellMentionLabel(mention);
}

/** The text under a node, with every `<br>` a line break. */
function nodeText(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.cellMention)
    return node.dataset.cellMention;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof HTMLBRElement) return '\n';
  return Array.from(node.childNodes).map(nodeText).join('');
}
/**
 * A `<br>` that ends the editor draws no line of its own: it only gives an
 * empty last line its height, so it is not part of the text. The editor adds
 * one after a trailing newline, which would otherwise draw no line and leave
 * the caret on the line above; the browser adds and drops its own as people
 * type and delete.
 */
function endsWithLineEnd(root: Node) {
  return root.lastChild instanceof HTMLBRElement;
}
export function readCellText(root: Node): string {
  const text = nodeText(root);
  return endsWithLineEnd(root) ? text.slice(0, -1) : text;
}
export function writeCellText(root: HTMLElement, value: string) {
  root.replaceChildren(
    ...cellTextParts(value).map((part) => {
      if (!part.mention) return document.createTextNode(part.text);
      const pill = document.createElement('span');
      pill.contentEditable = 'false';
      pill.dataset.cellMention = part.text;
      pill.className =
        'inline-block max-w-full align-bottom truncate rounded border border-edge-muted bg-accent/8 px-1 text-accent';
      pill.textContent = pillLabel(part.mention);
      return pill;
    }),
    ...(value.endsWith('\n') ? [document.createElement('br')] : [])
  );
}
export function cellTextSelection(root: HTMLElement) {
  const selection = document.getSelection();
  if (!selection?.rangeCount) return;
  const range = selection.getRangeAt(0);
  if (
    !root.contains(range.startContainer) ||
    !root.contains(range.endContainer)
  )
    return;
  const prefix = document.createRange();
  prefix.selectNodeContents(root);
  prefix.setEnd(range.startContainer, range.startOffset);
  // Only a range that reaches past the closing `<br>` counts it; stop there.
  const length = readCellText(root).length;
  const start = Math.min(nodeText(prefix.cloneContents()).length, length);
  const end = Math.min(start + nodeText(range.cloneContents()).length, length);
  return { start, end };
}
export function setCellTextCursor(root: HTMLElement, offset: number) {
  const range = document.createRange();
  for (const node of root.childNodes) {
    const length = nodeText(node).length;
    if (offset <= length) {
      if (node.nodeType === Node.TEXT_NODE) range.setStart(node, offset);
      else if (offset === 0) range.setStartBefore(node);
      else range.setStartAfter(node);
      range.collapse(true);
      document.getSelection()?.removeAllRanges();
      document.getSelection()?.addRange(range);
      return;
    }
    offset -= length;
  }
  range.selectNodeContents(root);
  range.collapse(false);
  document.getSelection()?.removeAllRanges();
  document.getSelection()?.addRange(range);
}
