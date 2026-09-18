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
