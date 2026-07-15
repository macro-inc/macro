import { $isListItemNode } from '@lexical/list';
import { $isTableCellNode, $isTableRowNode } from '@lexical/table';
import { $findMatchingParent } from '@lexical/utils';
import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $createListCell,
  $createTextCell,
  $getTable,
  buildTable,
  createTableTestEditor,
  placeCaret,
  pressTab,
} from './tableTestUtils';

function createTableEditor(): LexicalEditor {
  return createTableTestEditor({ tabIndentation: true });
}

function readRowCount(editor: LexicalEditor): number {
  return editor.getEditorState().read(() => {
    return $getTable().getChildren().filter($isTableRowNode).length;
  });
}

/** Returns the row/column index of the cell holding the caret, or null. */
function readAnchorCellPosition(
  editor: LexicalEditor
): { row: number; column: number } | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const cell = $findMatchingParent(
      selection.anchor.getNode(),
      $isTableCellNode
    );
    if (!$isTableCellNode(cell)) return null;
    const rowNode = cell.getParent();
    if (!$isTableRowNode(rowNode)) return null;
    const table = $getTable();
    const rows = table.getChildren().filter($isTableRowNode);
    const row = rows.indexOf(rowNode);
    const column = rowNode.getChildren().filter($isTableCellNode).indexOf(cell);
    return { row, column };
  });
}

/** Indent of the list item holding the caret, or null when not in one. */
function readAnchorListItemIndent(editor: LexicalEditor): number | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const listItem = $findMatchingParent(
      selection.anchor.getNode(),
      $isListItemNode
    );
    return listItem ? listItem.getIndent() : null;
  });
}

describe('tab in the bottom-right table cell', () => {
  it('adds a new row and moves the caret into its first cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createTextCell('a'), () => $createTextCell('b')],
      [() => $createTextCell('c'), () => $createTextCell('d')],
    ]);
    await placeCaret(editor, 'd'); // bottom-right cell

    await pressTab(editor);

    expect(readRowCount(editor)).toBe(3);
    expect(readAnchorCellPosition(editor)).toEqual({ row: 2, column: 0 });
  });

  it('does not add a row from a non-terminal cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createTextCell('a'), () => $createTextCell('b')],
      [() => $createTextCell('c'), () => $createTextCell('d')],
    ]);
    await placeCaret(editor, 'a'); // top-left cell

    await pressTab(editor);

    expect(readRowCount(editor)).toBe(2);
    expect(readAnchorCellPosition(editor)).toEqual({ row: 0, column: 1 });
  });

  it('does not add a row on Shift+Tab in the bottom-right cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createTextCell('a'), () => $createTextCell('b')],
      [() => $createTextCell('c'), () => $createTextCell('d')],
    ]);
    await placeCaret(editor, 'd');

    await pressTab(editor, true);

    expect(readRowCount(editor)).toBe(2);
    expect(readAnchorCellPosition(editor)).toEqual({ row: 1, column: 0 });
  });

  // The list-indent handler (registerTableListTab) is registered before this
  // row-insert handler, both at CRITICAL priority, so list indentation must
  // win over row insertion whenever the bottom-right cell holds an indentable
  // list item.
  it('indents an indentable list item instead of inserting a row', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createTextCell('a'), () => $createTextCell('b')],
      [() => $createTextCell('c'), () => $createListCell(['one', 'two'])],
    ]);
    await placeCaret(editor, 'two'); // list item in the bottom-right cell

    await pressTab(editor);

    // List indentation wins; no new row is added.
    expect(readAnchorListItemIndent(editor)).toBe(1);
    expect(readRowCount(editor)).toBe(2);
    expect(readAnchorCellPosition(editor)).toEqual({ row: 1, column: 1 });
  });

  it('inserts a row once the bottom-right list item can no longer indent', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createTextCell('a'), () => $createTextCell('b')],
      [() => $createTextCell('c'), () => $createListCell(['one', 'two'])],
    ]);
    await placeCaret(editor, 'two');

    await pressTab(editor); // indent to depth 1
    expect(readAnchorListItemIndent(editor)).toBe(1);
    expect(readRowCount(editor)).toBe(2);

    await pressTab(editor); // cannot indent deeper -> falls through to row insert

    expect(readRowCount(editor)).toBe(3);
    expect(readAnchorCellPosition(editor)).toEqual({ row: 2, column: 0 });
  });
});
