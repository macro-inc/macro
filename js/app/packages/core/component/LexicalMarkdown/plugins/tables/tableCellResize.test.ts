import { registerRichText } from '@lexical/rich-text';
import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  TableCellHeaderStates,
  type TableNode,
} from '@lexical/table';
import { SupportedNodeTypes } from '@lexical-core/node-list';
import {
  $createParagraphNode,
  $createTextNode,
  $getRoot,
  createEditor,
  type LexicalEditor,
} from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';
import {
  $applyResizeDrag,
  $captureResizeDrag,
  $revertResizeDrag,
  MIN_COLUMN_WIDTH,
} from './tableCellResize';
import { tablePlugin } from './tablePlugin';

function createTestEditor(): LexicalEditor {
  const editor = createEditor({
    namespace: 'table-cell-resize-test',
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

async function buildTable(
  editor: LexicalEditor,
  rows: number,
  columns: number
) {
  await new Promise<void>((resolve) => {
    editor.update(
      () => {
        const table = $createTableNode();
        for (let r = 0; r < rows; r++) {
          const row = $createTableRowNode();
          for (let c = 0; c < columns; c++) {
            const cell = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
            const paragraph = $createParagraphNode();
            paragraph.append($createTextNode(`${r},${c}`));
            cell.append(paragraph);
            row.append(cell);
          }
          table.append(row);
        }
        $getRoot().clear().append(table);
      },
      { onUpdate: () => resolve() }
    );
  });
}

// Must run inside editor.read/editor.update.
function $getTable(): TableNode {
  const table = $getRoot().getFirstChild();
  if (!$isTableNode(table)) throw new Error('no table');
  return table;
}

function getCellElement(
  editor: LexicalEditor,
  row: number,
  column: number
): HTMLElement {
  const cellKey = editor.read(() =>
    $getTable()
      .getChildren()
      .filter($isTableRowNode)
      [row].getChildren()
      .filter($isTableCellNode)
      [column].getKey()
  );
  const elem = editor.getElementByKey(cellKey);
  if (!elem) throw new Error('no cell element');
  return elem;
}

// jsdom lays nothing out, so rendered sizes are stubbed per element.
function stubRect(elem: HTMLElement, width: number) {
  elem.getBoundingClientRect = () =>
    ({
      width,
      height: 0,
      top: 0,
      left: 0,
      right: width,
      bottom: 0,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function getColWidths(editor: LexicalEditor): readonly number[] | undefined {
  return editor.read(() => $getTable().getColWidths());
}

describe('table column resize drag', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('captures rendered column widths and applies the delta live', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 2, 3);
    const renderedWidths = [150, 200, 250];
    for (let row = 0; row < 2; row++) {
      for (let column = 0; column < 3; column++) {
        stubRect(getCellElement(editor, row, column), renderedWidths[column]);
      }
    }

    const drag = editor.read(() =>
      $captureResizeDrag(editor, getCellElement(editor, 0, 1), 'right', 1)
    );
    expect(drag).toMatchObject({
      columnIndex: 1,
      baseWidths: renderedWidths,
      revertWidths: undefined,
    });

    editor.update(() => $applyResizeDrag(drag!, 40));
    expect(getColWidths(editor)).toEqual([150, 240, 250]);

    // Each frame applies against the drag-start snapshot, not the last frame.
    editor.update(() => $applyResizeDrag(drag!, 10));
    expect(getColWidths(editor)).toEqual([150, 210, 250]);
  });

  it('resizes the previous column when dragging a left edge', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 1, 3);
    for (let column = 0; column < 3; column++) {
      stubRect(getCellElement(editor, 0, column), 100 + column * 10);
    }

    const drag = editor.read(() =>
      $captureResizeDrag(editor, getCellElement(editor, 0, 1), 'left', 1)
    );
    expect(drag).toMatchObject({ columnIndex: 0 });

    editor.update(() => $applyResizeDrag(drag!, 30));
    expect(getColWidths(editor)).toEqual([130, 110, 120]);
  });

  it('has no drag for the left edge of the first column', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 1, 2);

    const drag = editor.read(() =>
      $captureResizeDrag(editor, getCellElement(editor, 0, 0), 'left', 1)
    );
    expect(drag).toBeUndefined();
  });

  it('clamps the column to the minimum width', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 1, 2);
    stubRect(getCellElement(editor, 0, 0), 300);
    stubRect(getCellElement(editor, 0, 1), 300);

    const drag = editor.read(() =>
      $captureResizeDrag(editor, getCellElement(editor, 0, 0), 'right', 1)
    );
    editor.update(() => $applyResizeDrag(drag!, -1000));
    expect(getColWidths(editor)).toEqual([MIN_COLUMN_WIDTH, 300]);
  });

  it('resizes the last spanned column of a merged cell', async () => {
    const editor = createTestEditor();
    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const table = $createTableNode();
          const mergedRow = $createTableRowNode();
          mergedRow.append(
            $createTableCellNode(TableCellHeaderStates.NO_STATUS, 2),
            $createTableCellNode(TableCellHeaderStates.NO_STATUS)
          );
          const plainRow = $createTableRowNode();
          for (let c = 0; c < 3; c++) {
            plainRow.append(
              $createTableCellNode(TableCellHeaderStates.NO_STATUS)
            );
          }
          table.append(mergedRow, plainRow);
          $getRoot().clear().append(table);
        },
        { onUpdate: () => resolve() }
      );
    });
    for (let column = 0; column < 3; column++) {
      stubRect(getCellElement(editor, 1, column), 100 + column * 10);
    }

    const mergedCellElem = getCellElement(editor, 0, 0);
    const drag = editor.read(() =>
      $captureResizeDrag(editor, mergedCellElem, 'right', 1)
    );
    expect(drag).toMatchObject({ columnIndex: 1 });

    editor.update(() => $applyResizeDrag(drag!, 50));
    expect(getColWidths(editor)).toEqual([100, 160, 120]);
  });

  it('reverts a cancelled drag to the pre-drag colWidths', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 1, 2);
    await new Promise<void>((resolve) => {
      editor.update(() => $getTable().setColWidths([130, 140]), {
        onUpdate: () => resolve(),
      });
    });
    stubRect(getCellElement(editor, 0, 0), 130);
    stubRect(getCellElement(editor, 0, 1), 140);

    const drag = editor.read(() =>
      $captureResizeDrag(editor, getCellElement(editor, 0, 0), 'right', 1)
    );
    editor.update(() => $applyResizeDrag(drag!, 400));
    expect(getColWidths(editor)).toEqual([530, 140]);

    editor.update(() => $revertResizeDrag(drag!));
    expect(getColWidths(editor)).toEqual([130, 140]);
  });

  it('reverts to unset colWidths when the table had none', async () => {
    const editor = createTestEditor();
    await buildTable(editor, 1, 2);
    stubRect(getCellElement(editor, 0, 0), 200);
    stubRect(getCellElement(editor, 0, 1), 200);

    const drag = editor.read(() =>
      $captureResizeDrag(editor, getCellElement(editor, 0, 0), 'right', 1)
    );
    editor.update(() => $applyResizeDrag(drag!, 25));
    expect(getColWidths(editor)).toEqual([225, 200]);

    editor.update(() => $revertResizeDrag(drag!));
    expect(getColWidths(editor)).toBeUndefined();
  });
});
