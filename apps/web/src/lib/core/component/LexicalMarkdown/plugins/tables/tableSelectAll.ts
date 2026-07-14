import {
  $computeTableMapSkipCellCheck,
  $createTableSelectionFrom,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableNode,
  $isTableSelection,
  type TableNode,
} from '@lexical/table';
import { $findMatchingParent } from '@lexical/utils';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_HIGH,
  type LexicalEditor,
  SELECT_ALL_COMMAND,
} from 'lexical';

/**
 * Scope Ctrl/Cmd+A inside a table: select the whole table first, and only
 * escalate to the document when the table is already fully selected.
 */
export function registerTableSelectAll(editor: LexicalEditor) {
  return editor.registerCommand(
    SELECT_ALL_COMMAND,
    () => {
      const selection = $getSelection();

      let tableNode: TableNode;
      if ($isRangeSelection(selection)) {
        const cellNode = $findMatchingParent(
          selection.anchor.getNode(),
          $isTableCellNode
        );
        if (!cellNode) return false;
        tableNode = $getTableNodeFromLexicalNodeOrThrow(cellNode);
      } else if ($isTableSelection(selection)) {
        const node = $getNodeByKey(selection.tableKey);
        if (!$isTableNode(node)) return false;
        tableNode = node;
      } else {
        return false;
      }

      const [tableMap] = $computeTableMapSkipCellCheck(tableNode, null, null);
      const lastRow = tableMap[tableMap.length - 1];
      if (!lastRow) return false;
      const firstCell = tableMap[0][0]?.cell;
      const lastCell = lastRow[lastRow.length - 1]?.cell;
      if (!firstCell || !lastCell) return false;

      if ($isTableSelection(selection)) {
        const shape = selection.getShape();
        const isFullTable =
          shape.fromX === 0 &&
          shape.fromY === 0 &&
          shape.toX === lastRow.length - 1 &&
          shape.toY === tableMap.length - 1;
        if (isFullTable) return false;
      }

      $setSelection($createTableSelectionFrom(tableNode, firstCell, lastCell));
      return true;
    },
    COMMAND_PRIORITY_HIGH
  );
}
