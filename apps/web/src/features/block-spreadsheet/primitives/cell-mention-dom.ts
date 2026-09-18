import {
  cellMentionLabel,
  cellTextParts,
} from '@macro-inc/spreadsheet/cell-mentions';

export function readCellText(node: Node): string {
  if (node instanceof HTMLElement && node.dataset.cellMention)
    return node.dataset.cellMention;
  if (node.nodeType === Node.TEXT_NODE) return node.textContent ?? '';
  if (node instanceof HTMLBRElement) return '\n';
  return Array.from(node.childNodes).map(readCellText).join('');
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
      pill.textContent = cellMentionLabel(part.mention);
      return pill;
    })
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
  const start = readCellText(prefix.cloneContents()).length;
  return { start, end: start + readCellText(range.cloneContents()).length };
}
export function setCellTextCursor(root: HTMLElement, offset: number) {
  const range = document.createRange();
  for (const node of root.childNodes) {
    const length = readCellText(node).length;
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
