import {
  $computeTableMap,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  type TableNode,
} from '@lexical/table';
import {
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
  SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
} from 'lexical';

/**
 * When a copied cell range is pasted into a table, the upstream
 * @lexical/table handler overlays it on the grid anchored at the cursor
 * cell, growing the table with new rows/columns when the range runs past
 * the edges. Growing rows reads naturally, but growing columns reshapes
 * the whole table, so this plugin clips the copied grid to the columns
 * available to the right of the anchor before the upstream handler runs.
 */
function registerTableClipboardPlugin(editor: LexicalEditor) {
  return editor.registerCommand(
    SELECTION_INSERT_CLIPBOARD_NODES_COMMAND,
    ({ nodes, selection }) => {
      if (nodes.length !== 1 || !$isTableNode(nodes[0])) return false;
      if (!$isRangeSelection(selection)) return false;

      const anchorCell = $getTableCellNodeFromLexicalNode(
        selection.anchor.getNode()
      );
      if (!$isTableCellNode(anchorCell)) return false;

      const destinationTable = $getTableNodeFromLexicalNodeOrThrow(anchorCell);
      const [destinationMap, anchorPosition] = $computeTableMap(
        destinationTable,
        anchorCell,
        anchorCell
      );
      const availableColumns =
        (destinationMap[0]?.length ?? 0) - anchorPosition.startColumn;
      if (availableColumns > 0) {
        $clipTableToWidth(nodes[0], availableColumns);
      }

      // Never claim the command — the upstream table plugin performs the
      // actual grid insertion with the (possibly clipped) template.
      return false;
    },
    COMMAND_PRIORITY_HIGH
  );
}

/** Removes cells past `maxColumns`, clamping colspans that straddle it. */
function $clipTableToWidth(table: TableNode, maxColumns: number): void {
  for (const row of table.getChildren()) {
    if (!$isTableRowNode(row)) continue;

    let column = 0;
    for (const cell of row.getChildren()) {
      if (!$isTableCellNode(cell)) continue;

      if (column >= maxColumns) {
        cell.remove();
        continue;
      }
      const span = cell.getColSpan();
      if (column + span > maxColumns) {
        cell.setColSpan(maxColumns - column);
      }
      column += span;
    }
  }
}

export function tableClipboardPlugin() {
  return (editor: LexicalEditor) => registerTableClipboardPlugin(editor);
}
