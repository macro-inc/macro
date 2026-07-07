/**
 * @file Column resize logic for tables, driven by the TableCellResizer
 * component. A drag captures a snapshot up front (which column, the rendered
 * widths, and the stored widths to restore on cancel), then applies its
 * running delta against that snapshot on every frame.
 */
import {
  $computeTableMapSkipCellCheck,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableNode,
} from '@lexical/table';
import {
  $getNearestNodeFromDOMNode,
  $getNodeByKey,
  type LexicalEditor,
} from 'lexical';

export const MIN_COLUMN_WIDTH = 120;

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
