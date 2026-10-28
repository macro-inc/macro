/**
 * @file Column and row resize logic for tables, driven by the TableCellResizer
 * component. A drag captures a snapshot up front (which column/row, the
 * rendered size, and the stored size to restore on cancel), then applies its
 * running delta against that snapshot on every frame.
 *
 * Row height is optional: unset rows stay content-sized and serialize without
 * a `height` attribute. Dragging a row writes height only on that row.
 */
import {
  $computeTableMapSkipCellCheck,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
} from '@lexical/table';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  type LexicalEditor,
} from 'lexical';

export const MIN_COLUMN_WIDTH = 120;
export const MIN_ROW_HEIGHT = 33;

// Which vertical edge of the cell is being dragged. Both name a column
// border: 'right' resizes the cell's own (last spanned) column, 'left' the
// column before it.
export type ResizeEdge = 'left' | 'right';

export type ResizeDragSnapshot = {
  tableKey: string;
  columnIndex: number;
  // Rendered column widths at drag start; the drag applies its delta to
  // these so the grabbed edge stays under the pointer even when the stored
  // colWidths disagree with the browser's actual layout.
  baseWidths: number[];
  revertWidths: readonly number[] | undefined;
};

export function $captureResizeDrag(
  editor: LexicalEditor,
  cellElem: HTMLElement,
  edge: ResizeEdge,
  zoom: number
): ResizeDragSnapshot | undefined {
  const cellNode = $getNearestNodeFromDOMNode(cellElem);
  if (!$isTableCellNode(cellNode)) return;
  const tableNode = $getTableNodeFromLexicalNodeOrThrow(cellNode);

  const [tableMap] = $computeTableMapSkipCellCheck(tableNode, null, null);
  const position = tableMap.flat().find((value) => value.cell === cellNode);
  if (!position) return;
  // A merged cell's right edge belongs to the last column it spans.
  const columnIndex =
    edge === 'right'
      ? position.startColumn + cellNode.getColSpan() - 1
      : position.startColumn - 1;
  if (columnIndex < 0) return;

  const revertWidths = tableNode.getColWidths();
  const columnCount = tableMap[0]?.length ?? 0;
  const baseWidths: number[] = [];
  for (let column = 0; column < columnCount; column++) {
    // Measure the column through any unmerged cell in it that has a layout
    // (zero width means hidden or not laid out yet).
    let width: number | undefined;
    for (const mapRow of tableMap) {
      const entry = mapRow[column];
      if (entry.cell.getColSpan() !== 1) continue;
      const rect = editor
        .getElementByKey(entry.cell.getKey())
        ?.getBoundingClientRect();
      if (rect && rect.width > 0) {
        width = rect.width / zoom;
        break;
      }
    }
    baseWidths.push(width ?? revertWidths?.[column] ?? MIN_COLUMN_WIDTH);
  }
  return {
    tableKey: tableNode.getKey(),
    columnIndex,
    baseWidths,
    revertWidths,
  };
}

export function $applyResizeDrag(
  drag: ResizeDragSnapshot,
  delta: number
): void {
  const tableNode = $getNodeByKey(drag.tableKey);
  if (!$isTableNode(tableNode) || !tableNode.isAttached()) return;
  const widths = [...drag.baseWidths];
  widths[drag.columnIndex] = Math.max(
    MIN_COLUMN_WIDTH,
    drag.baseWidths[drag.columnIndex] + delta
  );
  tableNode.setColWidths(widths);
}

export function $revertResizeDrag(drag: ResizeDragSnapshot): void {
  const tableNode = $getNodeByKey(drag.tableKey);
  if (!$isTableNode(tableNode) || !tableNode.isAttached()) return;
  tableNode.setColWidths(drag.revertWidths);
}

export type RowResizeDragSnapshot = {
  rowKey: string;
  // Rendered row height at drag start; the drag applies its delta to this
  // so the grabbed edge stays under the pointer even when the stored height
  // is unset (content-sized) or disagrees with layout.
  baseHeight: number;
  revertHeight: number | undefined;
};

export function $captureRowResizeDrag(
  editor: LexicalEditor,
  cellElem: HTMLElement,
  zoom: number
): RowResizeDragSnapshot | undefined {
  const cellNode = $getNearestNodeFromDOMNode(cellElem);
  if (!$isTableCellNode(cellNode)) return;
  const tableNode = $getTableNodeFromLexicalNodeOrThrow(cellNode);

  const [tableMap] = $computeTableMapSkipCellCheck(tableNode, null, null);
  const position = tableMap.flat().find((value) => value.cell === cellNode);
  if (!position) return;
  // A merged cell's bottom edge belongs to the last row it spans.
  const rowIndex = position.startRow + cellNode.getRowSpan() - 1;
  const rows = tableNode.getChildren().filter($isTableRowNode);
  const rowNode = rows[rowIndex];
  if (!rowNode) return;

  const revertHeight = rowNode.getHeight();
  const rect = editor
    .getElementByKey(rowNode.getKey())
    ?.getBoundingClientRect();
  const baseHeight =
    rect && rect.height > 0
      ? rect.height / zoom
      : (revertHeight ?? MIN_ROW_HEIGHT);

  return {
    rowKey: rowNode.getKey(),
    baseHeight,
    revertHeight,
  };
}

export function $applyRowResizeDrag(
  drag: RowResizeDragSnapshot,
  delta: number
): void {
  const rowNode = $getNodeByKey(drag.rowKey);
  if (!$isTableRowNode(rowNode) || !rowNode.isAttached()) return;
  rowNode.setHeight(Math.max(MIN_ROW_HEIGHT, drag.baseHeight + delta));
}

export function $revertRowResizeDrag(drag: RowResizeDragSnapshot): void {
  const rowNode = $getNodeByKey(drag.rowKey);
  if (!$isTableRowNode(rowNode) || !rowNode.isAttached()) return;
  rowNode.setHeight(drag.revertHeight);
}
