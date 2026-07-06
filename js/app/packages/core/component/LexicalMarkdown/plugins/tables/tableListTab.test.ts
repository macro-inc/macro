import {
  $createListItemNode,
  $createListNode,
  $isListItemNode,
} from '@lexical/list';
import { registerRichText } from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableCellNode,
  type TableNode,
} from '@lexical/table';
import { $findMatchingParent } from '@lexical/utils';
import { SupportedNodeTypes } from '@lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  $isRangeSelection,
  createEditor,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { describe, expect, it } from 'vitest';
import { tabIndentationPlugin } from '../tab-indentation';
import { tablePlugin } from './tablePlugin';

function createTableEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'table-list-tab-test',
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
  tabIndentationPlugin()(editor);
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

function $createListCell(items: string[]): TableCellNode {
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  const list = $createListNode('bullet');
  for (const item of items) {
    const listItem = $createListItemNode();
    listItem.append($createTextNode(item));
    list.append(listItem);
  }
  cell.append(list);
  return cell;
}

async function buildTable(
  editor: LexicalEditor,
  rows: Array<Array<() => TableCellNode>>
) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const table = $createTableNode();
        for (const rowCells of rows) {
          const row = $createTableRowNode();
          row.append(...rowCells.map(($createCell) => $createCell()));
          table.append(row);
        }
        $getRoot().clear().append(table);
      },
      { onUpdate: () => resolve() }
    );
  });
}

function $getTable(): TableNode {
  const table = $getRoot()
    .getChildren()
    .find((node) => $isTableNode(node));
  if (!table || !$isTableNode(table)) throw new Error('no table');
  return table;
}

function $getCell(row: number, column: number): TableCellNode {
  const rowNode = $getTable().getChildren().filter($isTableRowNode)[row];
  return rowNode.getChildren().filter($isTableCellNode)[column];
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

async function pressTab(editor: LexicalEditor, shiftKey = false) {
  editor.dispatchCommand(
    KEY_TAB_COMMAND,
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey })
  );
  await Promise.resolve();
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
