import { registerRichText } from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableSelectionFrom,
  $isTableNode,
  $isTableSelection,
  TableCellHeaderStates,
  type TableCellNode,
  type TableNode,
  type TableRowNode,
} from '@lexical/table';
import { SupportedNodeTypes } from '@lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  createEditor,
  type LexicalEditor,
  SELECT_ALL_COMMAND,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { tablePlugin } from './tablePlugin';

function createTableEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'table-select-all-test',
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  tablePlugin({
    hasCellMerge: true,
    hasCellBackgroundColor: true,
    hasTabHandler: true,
  })(editor);
  registerRichText(editor);
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.appendChild(rootElement);
  editor.setRootElement(rootElement);
  return editor;
}

function $createTextCell(text: string): TableCellNode {
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  cell.append(paragraph);
  return cell;
}

function $getTable(): TableNode {
  const table = $getRoot()
    .getChildren()
    .find((node) => $isTableNode(node));
  if (!table || !$isTableNode(table)) throw new Error('no table');
  return table;
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

/** Places a collapsed caret at the end of the text node matching `text`. */
async function placeCaret(editor: LexicalEditor, text: string) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const textNode = $getRoot()
          .getAllTextNodes()
          .find((node) => node.getTextContent() === text);
        if (!textNode) throw new Error(`no text node "${text}"`);
        const size = textNode.getTextContentSize();
        textNode.select(size, size);
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
