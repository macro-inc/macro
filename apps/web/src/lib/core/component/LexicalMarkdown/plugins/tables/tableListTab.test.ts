import { $isListItemNode } from '@lexical/list';
import { $isTableCellNode } from '@lexical/table';
import { $findMatchingParent } from '@lexical/utils';
import { $getSelection, $isRangeSelection, type LexicalEditor } from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $createListCell,
  $createTextCell,
  $getCell,
  buildTable,
  createTableTestEditor,
  placeCaret,
  pressTab,
} from './tableTestUtils';

function createTableEditor(): LexicalEditor {
  return createTableTestEditor({ tabIndentation: true });
}

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

function readAnchorCellKey(editor: LexicalEditor): string | null {
  return editor.getEditorState().read(() => {
    const selection = $getSelection();
    if (!$isRangeSelection(selection)) return null;
    const cell = $findMatchingParent(
      selection.anchor.getNode(),
      $isTableCellNode
    );
    return cell ? cell.getKey() : null;
  });
}

function readCellKey(editor: LexicalEditor, row: number, column: number) {
  return editor.getEditorState().read(() => $getCell(row, column).getKey());
}

describe('tab inside lists in table cells', () => {
  it('indents a list item instead of hopping to the next cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createListCell(['one', 'two']), () => $createTextCell('other')],
    ]);
    await placeCaret(editor, 'two');

    await pressTab(editor);

    expect(readAnchorListItemIndent(editor)).toBe(1);
    expect(readAnchorCellKey(editor)).toBe(readCellKey(editor, 0, 0));
  });

  it('falls through to cell navigation once the item cannot indent deeper', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createListCell(['one', 'two']), () => $createTextCell('other')],
    ]);
    await placeCaret(editor, 'two');

    await pressTab(editor); // indent to depth 1
    await pressTab(editor); // cannot go deeper -> hop to next cell

    expect(readAnchorCellKey(editor)).toBe(readCellKey(editor, 0, 1));
  });

  it('outdents a nested list item on Shift+Tab', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createListCell(['one', 'two']), () => $createTextCell('other')],
    ]);
    await placeCaret(editor, 'two');

    await pressTab(editor);
    expect(readAnchorListItemIndent(editor)).toBe(1);

    await pressTab(editor, true);
    expect(readAnchorListItemIndent(editor)).toBe(0);
  });

  it('navigates to the previous cell on Shift+Tab at the top level', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createTextCell('first'), () => $createListCell(['one', 'two'])],
    ]);
    await placeCaret(editor, 'two');

    await pressTab(editor, true);

    expect(readAnchorCellKey(editor)).toBe(readCellKey(editor, 0, 0));
  });

  it('still navigates cells from plain paragraph content', async () => {
    const editor = createTableEditor();
    await buildTable(editor, [
      [() => $createTextCell('first'), () => $createTextCell('second')],
    ]);
    await placeCaret(editor, 'first');

    await pressTab(editor);

    expect(readAnchorCellKey(editor)).toBe(readCellKey(editor, 0, 1));
  });
});
