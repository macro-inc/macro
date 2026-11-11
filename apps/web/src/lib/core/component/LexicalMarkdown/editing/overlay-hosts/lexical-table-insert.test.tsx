/** @vitest-environment jsdom */
import { $createTableNodeWithDimensions } from '@lexical/table';
import { $getRoot, type LexicalEditor } from 'lexical';
import { render } from 'solid-js/web';
import { expect, test, vi } from 'vitest';
import { behaviorEditor } from '../../behavior-inventory/editor';
import { HostedTableInsertButton } from '../../component/misc/TableInsertButton';
import { tablePlugin } from '../../plugins/tables/tablePlugin';
import { createLexicalTableInsertHost } from './lexical-table-insert';

test('Source insertion keeps its pending target when the dynamic editor disappears at click', () => {
  const fixture = behaviorEditor(tablePlugin({ hasCellMerge: true }));
  fixture.editor.update(
    () => $getRoot().append($createTableNodeWithDimensions(3, 3, false)),
    { discrete: true }
  );
  const cell = fixture.root.querySelector('td');
  const table = fixture.root.querySelector('table');
  if (!cell || !table) throw new Error('Missing actual Source table DOM');
  const cellRect = vi
    .spyOn(cell, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(20, 20, 100, 40));
  const tableRect = vi
    .spyOn(table, 'getBoundingClientRect')
    .mockReturnValue(new DOMRect(20, 20, 300, 120));
  let editor: LexicalEditor | undefined = fixture.editor;
  const host = createLexicalTableInsertHost(() => editor);
  const mount = document.createElement('div');
  document.body.append(mount);
  const release = render(() => <HostedTableInsertButton host={host} />, mount);
  try {
    cell.dispatchEvent(
      new MouseEvent('pointermove', { bubbles: true, clientX: 70, clientY: 59 })
    );
    const button = document.querySelector('button[aria-label="Insert row"]');
    if (!(button instanceof HTMLButtonElement))
      throw new Error('Missing actual insertion target');
    editor = undefined;
    button.click();
    expect(document.querySelector('button[aria-label="Insert row"]')).toBe(
      button
    );
    expect(fixture.root.querySelectorAll('tr')).toHaveLength(3);
    editor = fixture.editor;
    button.click();
    fixture.editor.read(() => {});
    expect(
      document.querySelector('button[aria-label="Insert row"]')
    ).toBeNull();
    expect(fixture.root.querySelectorAll('tr')).toHaveLength(4);
  } finally {
    release();
    mount.remove();
    cellRect.mockRestore();
    tableRect.mockRestore();
  }
});
