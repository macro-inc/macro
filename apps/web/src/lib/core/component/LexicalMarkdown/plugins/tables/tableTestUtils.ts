import { $createListItemNode, $createListNode } from '@lexical/list';
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
import { SupportedNodeTypes } from '@macro-inc/lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';
import { tabIndentationPlugin } from '../tab-indentation';
import { tablePlugin } from './tablePlugin';
import { tableTouchSelectionPlugin } from './tableTouchSelection';

interface CreateTableTestEditorOptions {
  /** Register {@link tabIndentationPlugin} (needed for list/tab tests). */
  tabIndentation?: boolean;
  /** Register {@link tableTouchSelectionPlugin} before rich text. */
  touchSelection?: boolean;
  /** Forwarded to {@link tablePlugin}; defaults to `true`. */
  hasCellMerge?: boolean;
  /** Forwarded to {@link tablePlugin}; defaults to `true`. */
  hasCellBackgroundColor?: boolean;
  /** Forwarded to {@link tablePlugin}; defaults to `true`. */
  hasTabHandler?: boolean;
}

/**
 * Single parameterized editor factory shared by the table plugin tests. The
 * plugin registration order mirrors the original per-file factories: the table
 * plugin first, then (optionally) the touch-selection plugin, then rich text,
 * then (optionally) tab indentation.
 */
export function createTableTestEditor(
  opts: CreateTableTestEditorOptions = {}
): LexicalEditor {
  const {
    tabIndentation = false,
    touchSelection = false,
    hasCellMerge = true,
    hasCellBackgroundColor = true,
    hasTabHandler = true,
  } = opts;

  const editor = createEditor({
    namespace: 'table-test',
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  tablePlugin({ hasCellMerge, hasCellBackgroundColor, hasTabHandler })(editor);
  if (touchSelection) tableTouchSelectionPlugin()(editor);
  registerRichText(editor);
  if (tabIndentation) tabIndentationPlugin()(editor);
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.appendChild(rootElement);
  editor.setRootElement(rootElement);
  return editor;
}

/** A cell containing a single paragraph with `text`. */
export function $createTextCell(text: string): TableCellNode {
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  cell.append(paragraph);
  return cell;
}

/** A cell containing a bullet list with one item per entry in `items`. */
export function $createListCell(items: string[]): TableCellNode {
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

/**
 * Builds a table from a grid of cell factories and installs it as the sole
 * child of the root. The factory-grid shape is the most general; use
 * {@link textGrid} / {@link coordGrid} to adapt simpler inputs.
 */
export async function buildTable(
  editor: LexicalEditor,
  grid: Array<Array<() => TableCellNode>>
) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const table = $createTableNode();
        for (const rowCells of grid) {
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

/** Adapts a `string[][]` grid to text-cell factories for {@link buildTable}. */
export function textGrid(rows: string[][]): Array<Array<() => TableCellNode>> {
  return rows.map((row) => row.map((text) => () => $createTextCell(text)));
}

/**
 * Produces a `rows`x`columns` grid whose cells are labeled `"${r},${c}"`,
 * matching the numeric `buildTable(editor, rows, cols)` the resize and touch
 * tests used to build inline.
 */
export function coordGrid(
  rows: number,
  columns: number
): Array<Array<() => TableCellNode>> {
  return Array.from({ length: rows }, (_, r) =>
    Array.from(
      { length: columns },
      (_, c) => () => $createTextCell(`${r},${c}`)
    )
  );
}

/** The first table node in the document. Must run inside editor.read/update. */
export function $getTable(): TableNode {
  const table = $getRoot()
    .getChildren()
    .find((node) => $isTableNode(node));
  if (!table || !$isTableNode(table)) throw new Error('no table');
  return table;
}

/** The cell at `row`/`column`. Must run inside editor.read/update. */
export function $getCell(row: number, column: number): TableCellNode {
  const rowNode = $getTable().getChildren().filter($isTableRowNode)[row];
  return rowNode.getChildren().filter($isTableCellNode)[column];
}

/** The text content of every cell, row by row. */
export function readCellTexts(editor: LexicalEditor): string[][] {
  return editor.getEditorState().read(() =>
    $getTable()
      .getChildren()
      .filter($isTableRowNode)
      .map((row) =>
        row
          .getChildren()
          .filter($isTableCellNode)
          .map((cell) => cell.getTextContent())
      )
  );
}

/** Places a collapsed caret at the end of the text node matching `text`. */
export async function placeCaret(editor: LexicalEditor, text: string) {
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

/** Dispatches a Tab (or Shift+Tab) key command and flushes microtasks. */
export async function pressTab(editor: LexicalEditor, shiftKey = false) {
  editor.dispatchCommand(
    KEY_TAB_COMMAND,
    new KeyboardEvent('keydown', { key: 'Tab', shiftKey })
  );
  await Promise.resolve();
}
