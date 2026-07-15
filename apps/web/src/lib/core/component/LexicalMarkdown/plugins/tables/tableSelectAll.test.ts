import {
  $createTableNode,
  $createTableRowNode,
  $createTableSelectionFrom,
  $isTableSelection,
  type TableCellNode,
  type TableRowNode,
} from '@lexical/table';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  type LexicalEditor,
  SELECT_ALL_COMMAND,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import {
  $createTextCell,
  $getTable,
  createTableTestEditor,
  placeCaret,
} from './tableTestUtils';

function createTableEditor(): LexicalEditor {
  return createTableTestEditor();
}

/** Builds: paragraph("before"), 2x2 table, paragraph("after"). */
async function buildDoc(editor: LexicalEditor) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const table = $createTableNode();
        for (const rowTexts of [
          ['a1', 'b1'],
          ['a2', 'b2'],
        ]) {
          const row = $createTableRowNode();
          row.append(...rowTexts.map((text) => $createTextCell(text)));
          table.append(row);
        }
        const before = $createParagraphNode();
        before.append($createTextNode('before'));
        const after = $createParagraphNode();
        after.append($createTextNode('after'));
        $getRoot().clear().append(before, table, after);
      },
      { onUpdate: () => resolve() }
    );
  });
}

async function pressSelectAll(editor: LexicalEditor) {
  editor.dispatchCommand(
    SELECT_ALL_COMMAND,
    new KeyboardEvent('keydown', { key: 'a', ctrlKey: true })
  );
  await Promise.resolve();
}

describe('tableSelectAll', () => {
  it('selects the whole table when the caret is in a cell', async () => {
    const editor = createTableEditor();
    await buildDoc(editor);
    await placeCaret(editor, 'b1');

    await pressSelectAll(editor);

    editor.read(() => {
      const selection = $getSelection();
      if (!$isTableSelection(selection)) throw new Error('no table selection');
      const shape = selection.getShape();
      expect(shape).toEqual({ fromX: 0, fromY: 0, toX: 1, toY: 1 });
    });
  });

  it('expands a partial cell selection to the whole table', async () => {
    const editor = createTableEditor();
    await buildDoc(editor);
    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const table = $getTable();
          const firstCell = table
            .getFirstChildOrThrow<TableRowNode>()
            .getFirstChildOrThrow<TableCellNode>();
          $setSelection($createTableSelectionFrom(table, firstCell, firstCell));
        },
        { onUpdate: () => resolve() }
      );
    });

    await pressSelectAll(editor);

    editor.read(() => {
      const selection = $getSelection();
      if (!$isTableSelection(selection)) throw new Error('no table selection');
      expect(selection.getShape()).toEqual({
        fromX: 0,
        fromY: 0,
        toX: 1,
        toY: 1,
      });
    });
  });

  it('escalates to the document when the table is already fully selected', async () => {
    const editor = createTableEditor();
    await buildDoc(editor);
    await placeCaret(editor, 'a2');

    await pressSelectAll(editor);
    await pressSelectAll(editor);

    editor.read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.getTextContent()).toContain('before');
      expect(selection.getTextContent()).toContain('after');
    });
  });

  it('leaves select-all alone outside tables', async () => {
    const editor = createTableEditor();
    await buildDoc(editor);
    await placeCaret(editor, 'before');

    await pressSelectAll(editor);

    editor.read(() => {
      const selection = $getSelection();
      expect($isRangeSelection(selection)).toBe(true);
      if (!$isRangeSelection(selection)) return;
      expect(selection.getTextContent()).toContain('after');
    });
  });
});
