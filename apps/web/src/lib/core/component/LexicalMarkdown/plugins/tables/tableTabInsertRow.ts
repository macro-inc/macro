import {
  $insertTableRowAtSelection,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
} from '@lexical/table';
import { $findMatchingParent } from '@lexical/utils';
import {
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  KEY_TAB_COMMAND,
  type LexicalEditor,
} from 'lexical';

/**
 * When Tab is pressed with the caret in the bottom-right cell of a table, the
 * table selection observer would move the selection out of the table. Instead,
 * append a new row and drop the caret into its leftmost cell, matching the
 * "Tab to grow the table" behavior found in most rich-text editors.
 *
 * Registered at CRITICAL priority (like {@link registerTableListTab}) so it
 * preempts the library's HIGH-priority cell-navigation handler. It must be
 * registered *after* {@link registerTableListTab} so list indentation inside a
 * cell still wins when it applies.
 */
export function registerTableTabInsertRow(editor: LexicalEditor) {
  return editor.registerCommand<KeyboardEvent>(
    KEY_TAB_COMMAND,
    (event) => {
      // Shift+Tab keeps its "go to previous cell" behavior.
      if (event.shiftKey) return false;

      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
      }

      const cell = $findMatchingParent(
        selection.anchor.getNode(),
        $isTableCellNode
      );
      if (!$isTableCellNode(cell)) return false;

      const row = cell.getParent();
      if (!$isTableRowNode(row)) return false;

      const table = row.getParent();
      if (!$isTableNode(table)) return false;

      // Only the bottom-right cell: no cell to the right and no row below.
      if (cell.getNextSibling() !== null || row.getNextSibling() !== null) {
        return false;
      }

      event.preventDefault();
      const newRow = $insertTableRowAtSelection(true);
      const firstCell = newRow?.getFirstChild();
      if ($isTableCellNode(firstCell)) firstCell.selectStart();
      return true;
    },
    COMMAND_PRIORITY_CRITICAL
  );
}
