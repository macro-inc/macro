import {
  $computeTableMap,
  $deleteTableColumnAtSelection,
  $deleteTableRowAtSelection,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableSelection,
  type TableCellNode,
  type TableNode,
} from '@lexical/table';
import { $getSelection } from 'lexical';

type TableSelectionRange = {
  table: TableNode;
  minRow: number;
  maxRow: number;
  minColumn: number;
  maxColumn: number;
};

/**
 * Grid span of the current table selection, or null when the selection is
 * not a table selection.
 */
function $getTableSelectionRange(): TableSelectionRange | null {
  const selection = $getSelection();
  if (!$isTableSelection(selection)) return null;
  const anchorCell = $getTableCellNodeFromLexicalNode(
    selection.anchor.getNode()
  );
  const focusCell = $getTableCellNodeFromLexicalNode(selection.focus.getNode());
  if (!anchorCell || !focusCell) return null;
  const table = $getTableNodeFromLexicalNodeOrThrow(anchorCell);
  const [, aPos, fPos] = $computeTableMap(table, anchorCell, focusCell);
  return {
    table,
    minRow: Math.min(aPos.startRow, fPos.startRow),
    maxRow: Math.max(
      aPos.startRow + anchorCell.getRowSpan() - 1,
      fPos.startRow + focusCell.getRowSpan() - 1
    ),
    minColumn: Math.min(aPos.startColumn, fPos.startColumn),
    maxColumn: Math.max(
      aPos.startColumn + anchorCell.getColSpan() - 1,
      fPos.startColumn + focusCell.getColSpan() - 1
    ),
  };
}

/**
 * The current table selection, if it lives in the same table as `cell`.
 */
function $tableSelectionRangeForCell(
  cell: TableCellNode
): TableSelectionRange | null {
  const range = $getTableSelectionRange();
  if (!range) return null;
  const table = $getTableNodeFromLexicalNodeOrThrow(cell);
  if (table.getKey() !== range.table.getKey()) return null;
  return range;
}

export type TableDeleteHoverExtent = TableSelectionRange & {
  expandRows: boolean;
  expandColumns: boolean;
};

/**
 * How far a table selection should expand the hover-delete highlight, if
 * the hovered cell shares a table with that selection.
 */
export function $selectionDeleteExtent(
  hoveredCell: TableCellNode
): TableDeleteHoverExtent | null {
  const range = $tableSelectionRangeForCell(hoveredCell);
  if (!range) return null;
  const [, pos] = $computeTableMap(range.table, hoveredCell, hoveredCell);
  return {
    ...range,
    expandRows: pos.startRow >= range.minRow && pos.startRow <= range.maxRow,
    expandColumns:
      pos.startColumn >= range.minColumn && pos.startColumn <= range.maxColumn,
  };
}

/**
 * Whether a table selection already covers the hovered cell's row (or
 * column). When it does, the hover delete control should act on that whole
 * selection rather than collapsing to a single cell.
 */
function $selectionCoversHoveredAxis(
  hoveredCell: TableCellNode,
  axis: 'row' | 'column'
): boolean {
  const extent = $selectionDeleteExtent(hoveredCell);
  if (!extent) return false;
  return axis === 'row' ? extent.expandRows : extent.expandColumns;
}

/**
 * Delete the hovered row, column, or whole table. If a table selection
 * already covers the hovered axis, the selection is left intact so Lexical
 * removes every selected row or column; otherwise the caret is moved into
 * `hoveredCell` first (single row/column).
 *
 * Must run inside an editor update.
 */
export function $deleteTableAtHover(
  hoveredCell: TableCellNode,
  type: 'row' | 'column' | 'table'
): void {
  if (type === 'table') {
    $getTableNodeFromLexicalNodeOrThrow(hoveredCell).remove();
    return;
  }
  if (!$selectionCoversHoveredAxis(hoveredCell, type)) {
    hoveredCell.selectStart();
  }
  if (type === 'row') $deleteTableRowAtSelection();
  else $deleteTableColumnAtSelection();
}
