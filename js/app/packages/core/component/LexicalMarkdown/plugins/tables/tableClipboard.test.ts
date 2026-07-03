import {
  $generateJSONFromSelectedNodes,
  $generateNodesFromSerializedNodes,
  $getClipboardDataFromSelection,
  $insertGeneratedNodes,
} from '@lexical/clipboard';
import { registerRichText } from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $createTableSelection,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableCellNode,
  type TableNode,
} from '@lexical/table';
import { SupportedNodeTypes } from '@lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  $getSelection,
  createEditor,
  type LexicalEditor,
  PASTE_COMMAND,
  type SerializedLexicalNode,
} from 'lexical';
import { describe, expect, it, vi } from 'vitest';

// The markdown-paste plugin only needs setEditorStateFromMarkdown for
// plain-text pastes, which these tests never exercise. Mocking the utils
// barrel keeps the rest of the app (workers, websockets) out of the test.
vi.mock('../../utils', () => ({
  setEditorStateFromMarkdown: vi.fn(),
}));

import { nodeIdPlugin } from '@lexical-core/plugins/nodeIdPlugin';
import { markdownPastePlugin } from '../markdown-paste/markdownPastePlugin';
import { tableClipboardPlugin } from './tableClipboardPlugin';
import { tablePlugin } from './tablePlugin';

// jsdom implements neither ClipboardEvent nor DataTransfer; the paste
// handlers only rely on `instanceof ClipboardEvent` and `clipboardData`.
if (typeof globalThis.ClipboardEvent === 'undefined') {
  class PolyfillClipboardEvent extends Event {
    clipboardData: DataTransfer | null = null;
  }
  globalThis.ClipboardEvent =
    PolyfillClipboardEvent as unknown as typeof ClipboardEvent;
}
if (typeof globalThis.DragEvent === 'undefined') {
  class PolyfillDragEvent extends Event {
    dataTransfer: DataTransfer | null = null;
  }
  globalThis.DragEvent = PolyfillDragEvent as unknown as typeof DragEvent;
}

function createTableEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'table-clipboard-test',
    nodes: SupportedNodeTypes,
    onError: (error) => {
      throw error;
    },
  });
  tablePlugin({
    hasCellMerge: true,
    hasCellBackgroundColor: true,
    hasTabHandler: true,
    hasHorizontalScroll: true,
  })(editor);
  tableClipboardPlugin()(editor);
  const rootElement = document.createElement('div');
  rootElement.contentEditable = 'true';
  document.body.appendChild(rootElement);
  editor.setRootElement(rootElement);
  return editor;
}

function $createCell(text: string): TableCellNode {
  const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
  const paragraph = $createParagraphNode();
  paragraph.append($createTextNode(text));
  cell.append(paragraph);
  return cell;
}

/** Builds a table from a grid of cell texts and appends it to the root. */
async function buildTable(editor: LexicalEditor, grid: string[][]) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const table = $createTableNode();
        for (const rowTexts of grid) {
          const row = $createTableRowNode();
          row.append(...rowTexts.map($createCell));
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
  if (!table || !$isTableNode(table)) throw new Error('no table in document');
  return table;
}

function $getCell(row: number, column: number): TableCellNode {
  const rowNode = $getTable().getChildren().filter($isTableRowNode)[row];
  const cell = rowNode.getChildren().filter($isTableCellNode)[column];
  if (!cell) throw new Error(`no cell at ${row},${column}`);
  return cell;
}

function readCellTexts(editor: LexicalEditor): string[][] {
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

/** Simulates copying a rectangle of cells the way COPY_COMMAND does. */
function copyCells(
  editor: LexicalEditor,
  from: [number, number],
  to: [number, number]
): SerializedLexicalNode[] {
  return editor.read(() => {
    const selection = $createTableSelection();
    selection.set(
      $getTable().getKey(),
      $getCell(...from).getKey(),
      $getCell(...to).getKey()
    );
    return $generateJSONFromSelectedNodes(editor, selection).nodes;
  });
}

/** Simulates pasting previously-copied nodes with the cursor in a cell. */
async function pasteIntoCell(
  editor: LexicalEditor,
  copied: SerializedLexicalNode[],
  target: [number, number]
) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        $getCell(...target).selectStart();
        const selection = $getSelection();
        if (!selection) throw new Error('no selection');
        const nodes = $generateNodesFromSerializedNodes(copied);
        $insertGeneratedNodes(editor, nodes, selection);
      },
      { onUpdate: () => resolve() }
    );
  });
}

const GRID = [
  ['01', '02', '03'],
  ['04', '05', '06'],
  ['07', '08', '09'],
];

describe('table cell range copy/paste', () => {
  it('copies a cell range as a single sub-table', async () => {
    const editor = createTableEditor();
    await buildTable(editor, GRID);

    const copied = copyCells(editor, [0, 0], [0, 1]);

    expect(copied).toHaveLength(1);
    const table = copied[0] as SerializedLexicalNode & { children: unknown[] };
    expect(table.type).toBe('table');
    expect(table.children).toHaveLength(1);
    const row = table.children[0] as { type: string; children: unknown[] };
    expect(row.type).toBe('tablerow');
    expect(row.children).toHaveLength(2);
  });

  it('pastes a copied range anchored at the cursor cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, GRID);

    const copied = copyCells(editor, [0, 0], [0, 1]);
    await pasteIntoCell(editor, copied, [1, 1]);

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['04', '01', '02'],
      ['07', '08', '09'],
    ]);
  });

  it('pastes a 2D range anchored at the cursor cell', async () => {
    const editor = createTableEditor();
    await buildTable(editor, GRID);

    const copied = copyCells(editor, [0, 0], [1, 1]);
    await pasteIntoCell(editor, copied, [1, 1]);

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['04', '01', '02'],
      ['07', '04', '05'],
    ]);
  });

  it('clips the pasted range instead of adding columns on horizontal overflow', async () => {
    const editor = createTableEditor();
    await buildTable(editor, GRID);

    const copied = copyCells(editor, [0, 0], [0, 1]);
    await pasteIntoCell(editor, copied, [2, 2]);

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['04', '05', '06'],
      ['07', '08', '01'],
    ]);
  });

  it('still grows the table with new rows on vertical overflow', async () => {
    const editor = createTableEditor();
    await buildTable(editor, GRID);

    const copied = copyCells(editor, [0, 0], [1, 0]);
    await pasteIntoCell(editor, copied, [2, 0]);

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['04', '05', '06'],
      ['01', '08', '09'],
      ['04', '', ''],
    ]);
  });

  it('aligns the paste through the full PASTE_COMMAND plugin chain', async () => {
    const editor = createTableEditor();
    // Register in the same order as the app: nodeIdPlugin comes first (via
    // LexicalWrapperContext) and once hijacked this command — see the
    // regression test note below.
    nodeIdPlugin({
      nodes: SupportedNodeTypes,
      idLength: 8,
      mappings: {
        idToNodeKeyMap: new Map(),
        nodeKeyToIdMap: new Map(),
      },
    })(editor);
    registerRichText(editor);
    markdownPastePlugin()(editor);
    await buildTable(editor, GRID);

    // Capture real clipboard data (lexical + html + plain) from a table
    // selection over "01" and "02", the way COPY_COMMAND would produce it.
    const clipboardData = editor.read(() => {
      const selection = $createTableSelection();
      selection.set(
        $getTable().getKey(),
        $getCell(0, 0).getKey(),
        $getCell(0, 1).getKey()
      );
      return $getClipboardDataFromSelection(selection);
    });

    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          $getCell(1, 1).selectStart();
        },
        { onUpdate: () => resolve() }
      );
    });

    // jsdom has no DataTransfer constructor; fake the minimal surface the
    // paste handlers read (types/getData/files).
    const event = new ClipboardEvent('paste', { cancelable: true });
    Object.defineProperty(event, 'clipboardData', {
      value: {
        types: Object.keys(clipboardData),
        files: [],
        items: [],
        getData: (type: string) =>
          (clipboardData as Record<string, string | undefined>)[type] ?? '',
      },
    });

    editor.dispatchCommand(PASTE_COMMAND, event);
    await Promise.resolve();

    expect(readCellTexts(editor)).toEqual([
      ['01', '02', '03'],
      ['04', '01', '02'],
      ['07', '08', '09'],
    ]);
  });
});
