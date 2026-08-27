import {
  $createTableCellNode,
  $createTableNode,
  $createTableRowNode,
  $isTableRowNode,
  TableCellHeaderStates,
} from '@lexical/table';
import { $getRoot, type LexicalEditor } from 'lexical';
import { afterEach, describe, expect, it } from 'vitest';
import {
  $applyResizeDrag,
  $applyRowResizeDrag,
  $captureResizeDrag,
  $captureRowResizeDrag,
  $revertResizeDrag,
  $revertRowResizeDrag,
  MIN_COLUMN_WIDTH,
  MIN_ROW_HEIGHT,
} from './tableCellResize';
import {
  $getCell,
  $getTable,
  buildTable,
  coordGrid,
  createTableTestEditor,
} from './tableTestUtils';

function createTestEditor(): LexicalEditor {
  return createTableTestEditor();
}

function getCellElement(
  editor: LexicalEditor,
  row: number,
  column: number
): HTMLElement {
  const cellKey = editor.read(() => $getCell(row, column).getKey());
  const elem = editor.getElementByKey(cellKey);
  if (!elem) throw new Error('no cell element');
  return elem;
}

// jsdom lays nothing out, so rendered sizes are stubbed per element.
function stubRect(elem: HTMLElement, width: number, height = 0) {
  elem.getBoundingClientRect = () =>
    ({
      width,
      height,
      top: 0,
      left: 0,
      right: width,
      bottom: height,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    }) as DOMRect;
}

function getColWidths(editor: LexicalEditor): readonly number[] | undefined {
  return editor.read(() => $getTable().getColWidths());
}

function getRowElement(editor: LexicalEditor, row: number): HTMLElement {
  const rowKey = editor.read(() => {
    const rowNode = $getTable().getChildren().filter($isTableRowNode)[row];
    return rowNode.getKey();
  });
  const elem = editor.getElementByKey(rowKey);
  if (!elem) throw new Error('no row element');
  return elem;
}

function getRowHeights(editor: LexicalEditor): (number | undefined)[] {
  return editor.read(() =>
    $getTable()
      .getChildren()
      .filter($isTableRowNode)
      .map((row) => row.getHeight())
  );
}

describe('table column resize drag', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('captures rendered column widths and applies the delta live', async () => {
    const editor = createTestEditor();
    await buildTable(editor, coordGrid(2, 3));
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
    await buildTable(editor, coordGrid(1, 3));
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
    await buildTable(editor, coordGrid(1, 2));

    const drag = editor.read(() =>
      $captureResizeDrag(editor, getCellElement(editor, 0, 0), 'left', 1)
    );
    expect(drag).toBeUndefined();
  });

  it('clamps the column to the minimum width', async () => {
    const editor = createTestEditor();
    await buildTable(editor, coordGrid(1, 2));
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
    await buildTable(editor, coordGrid(1, 2));
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
    await buildTable(editor, coordGrid(1, 2));
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

describe('table row resize drag', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('writes height only on the dragged row, leaving siblings unset', async () => {
    const editor = createTestEditor();
    await buildTable(editor, coordGrid(2, 2));
    stubRect(getRowElement(editor, 0), 0, 40);
    stubRect(getRowElement(editor, 1), 0, 40);

    const drag = editor.read(() =>
      $captureRowResizeDrag(editor, getCellElement(editor, 0, 0), 1)
    );
    expect(drag).toMatchObject({
      baseHeight: 40,
      revertHeight: undefined,
    });

    editor.update(() => $applyRowResizeDrag(drag!, 24));
    expect(getRowHeights(editor)).toEqual([64, undefined]);

    // Each frame applies against the drag-start snapshot, not the last frame.
    editor.update(() => $applyRowResizeDrag(drag!, 10));
    expect(getRowHeights(editor)).toEqual([50, undefined]);
  });

  it('clamps the row to the minimum height', async () => {
    const editor = createTestEditor();
    await buildTable(editor, coordGrid(1, 1));
    stubRect(getRowElement(editor, 0), 0, 80);

    const drag = editor.read(() =>
      $captureRowResizeDrag(editor, getCellElement(editor, 0, 0), 1)
    );
    editor.update(() => $applyRowResizeDrag(drag!, -1000));
    expect(getRowHeights(editor)).toEqual([MIN_ROW_HEIGHT]);
  });

  it('resizes the last spanned row of a merged cell', async () => {
    const editor = createTestEditor();
    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const table = $createTableNode();
          const mergedRow = $createTableRowNode();
          const merged = $createTableCellNode(TableCellHeaderStates.NO_STATUS);
          merged.setRowSpan(2);
          mergedRow.append(
            merged,
            $createTableCellNode(TableCellHeaderStates.NO_STATUS)
          );
          const continuation = $createTableRowNode();
          continuation.append(
            $createTableCellNode(TableCellHeaderStates.NO_STATUS)
          );
          table.append(mergedRow, continuation);
          $getRoot().clear().append(table);
        },
        { onUpdate: () => resolve() }
      );
    });
    stubRect(getRowElement(editor, 0), 0, 40);
    stubRect(getRowElement(editor, 1), 0, 50);

    const drag = editor.read(() =>
      $captureRowResizeDrag(editor, getCellElement(editor, 0, 0), 1)
    );
    expect(drag).toMatchObject({
      baseHeight: 50,
      revertHeight: undefined,
    });

    editor.update(() => $applyRowResizeDrag(drag!, 20));
    expect(getRowHeights(editor)).toEqual([undefined, 70]);
  });

  it('reverts a cancelled drag to the pre-drag height', async () => {
    const editor = createTestEditor();
    await buildTable(editor, coordGrid(1, 1));
    await new Promise<void>((resolve) => {
      editor.update(
        () => {
          const [row] = $getTable().getChildren().filter($isTableRowNode);
          row.setHeight(48);
        },
        { onUpdate: () => resolve() }
      );
    });
    stubRect(getRowElement(editor, 0), 0, 48);

    const drag = editor.read(() =>
      $captureRowResizeDrag(editor, getCellElement(editor, 0, 0), 1)
    );
    editor.update(() => $applyRowResizeDrag(drag!, 30));
    expect(getRowHeights(editor)).toEqual([78]);

    editor.update(() => $revertRowResizeDrag(drag!));
    expect(getRowHeights(editor)).toEqual([48]);
  });

  it('reverts to unset height when the row had none', async () => {
    const editor = createTestEditor();
    await buildTable(editor, coordGrid(2, 1));
    stubRect(getRowElement(editor, 0), 0, 40);

    const drag = editor.read(() =>
      $captureRowResizeDrag(editor, getCellElement(editor, 0, 0), 1)
    );
    editor.update(() => $applyRowResizeDrag(drag!, 25));
    expect(getRowHeights(editor)).toEqual([65, undefined]);

    editor.update(() => $revertRowResizeDrag(drag!));
    expect(getRowHeights(editor)).toEqual([undefined, undefined]);
  });
});
