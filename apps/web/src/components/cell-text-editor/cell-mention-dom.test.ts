import { encodeCellMention } from '@macro-inc/spreadsheet/cell-mentions';
import { expect, it } from 'vitest';
import {
  cellTextSelection,
  readCellText,
  setCellTextCursor,
  writeCellText,
} from './cell-mention-dom';

it('edits mention tokens atomically and maps selection offsets to the canonical cell input', () => {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  const token = encodeCellMention({
    type: 'user',
    userId: 'macro|a@b.com',
    email: 'a@b.com',
    displayName: 'Alice',
  });
  const value = `Owner ${token} next`;
  writeCellText(root, value);
  expect(root.textContent).toBe('Owner @Alice next');
  expect(root.querySelector('span')?.contentEditable).toBe('false');
  setCellTextCursor(root, 6 + token.length);
  expect(cellTextSelection(root)).toEqual({
    start: 6 + token.length,
    end: 6 + token.length,
  });
  expect(readCellText(root)).toBe(value);
  writeCellText(root, '**literal** <script>unsafe</script>');
  expect(root.querySelector('script')).toBeNull();
  expect(root.textContent).toBe('**literal** <script>unsafe</script>');
  root.remove();
});
it('labels date pills relative to today while keeping the stored instant', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const tomorrow = new Date();
  tomorrow.setHours(0, 0, 0, 0);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const token = encodeCellMention({
    type: 'date',
    date: tomorrow.toISOString(),
    displayFormat: 'Next week',
  });
  writeCellText(root, `Due ${token}`);
  expect(root.textContent).toBe('Due Tomorrow');
  expect(root.querySelector('span')?.contentEditable).toBe('false');
  expect(readCellText(root)).toBe(`Due ${token}`);
  root.remove();
});
it('ends a value with a line break on an empty line the caret can reach', () => {
  const root = document.createElement('div');
  root.contentEditable = 'true';
  document.body.append(root);
  writeCellText(root, 'First\n');
  // A trailing newline alone draws no line; the closing break holds it open.
  expect(root.lastChild).toBeInstanceOf(HTMLBRElement);
  expect(readCellText(root)).toBe('First\n');
  setCellTextCursor(root, 'First\n'.length);
  expect(cellTextSelection(root)).toEqual({ start: 6, end: 6 });
  const all = document.createRange();
  all.selectNodeContents(root);
  getSelection()?.removeAllRanges();
  getSelection()?.addRange(all);
  expect(cellTextSelection(root)).toEqual({ start: 0, end: 6 });
  // The browser leaves its own closing break when a new line is deleted again.
  root.replaceChildren(
    document.createTextNode('First'),
    document.createElement('br')
  );
  expect(readCellText(root)).toBe('First');
  root.replaceChildren(
    document.createTextNode('a'),
    document.createElement('br'),
    document.createTextNode('b')
  );
  expect(readCellText(root)).toBe('a\nb');
  root.remove();
});
