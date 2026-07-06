import {
  $getClipboardDataFromSelection,
  copyToClipboard,
} from '@lexical/clipboard';
import {
  $computeTableMap,
  $getTableCellNodeFromLexicalNode,
  $getTableNodeFromLexicalNodeOrThrow,
  $isTableCellNode,
  $isTableNode,
  $isTableRowNode,
  $isTableSelection,
  type TableNode,
  type TableSelection,
} from '@lexical/table';
import { mergeRegister, objectKlassEquals } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  COMMAND_PRIORITY_HIGH,
  CUT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
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
  return mergeRegister(
    registerTablePasteClip(editor),
    registerTableCellClear(editor)
  );
}

function registerTablePasteClip(editor: LexicalEditor) {
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

/**
 * Cut and Delete/Backspace over a multi-cell selection should empty the
 * selected cells. @lexical/table binds those to its own handler that calls
 * `$clearText`, which refills each cell with a paragraph containing an *empty*
 * TextNode; Lexical's text normalizer then removes that node mid-transform and
 * throws `"__first" is read-only` under the Loro collab layer, rolling the
 * whole update back so the cells look untouched. We register above it
 * (CRITICAL > the table plugin's HIGH), claim the command, and clear cells the
 * way `tableMove.ts` does — a bare paragraph, no empty TextNode — which the
 * normalizer leaves alone.
 */
function registerTableCellClear(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerCommand(
      CUT_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isTableSelection(selection)) return false;
        // Snapshot the clipboard payload before mutating. A keyboard-driven
        // cut has no ClipboardEvent, so fall back to the execCommand path.
        void copyToClipboard(
          editor,
          objectKlassEquals(event, ClipboardEvent)
            ? (event as ClipboardEvent)
            : null,
          $getClipboardDataFromSelection(selection)
        );
        return $clearSelectedCells(selection);
      },
      COMMAND_PRIORITY_CRITICAL
    ),
    ...[KEY_BACKSPACE_COMMAND, KEY_DELETE_COMMAND].map((command) =>
      editor.registerCommand(
        command,
        (event) => {
          const selection = $getSelection();
          if (!$isTableSelection(selection)) return false;
          if (!$clearSelectedCells(selection)) return false;
          event?.preventDefault();
          return true;
        },
        COMMAND_PRIORITY_CRITICAL
      )
    )
  );
}

/**
 * Empties every cell in `selection`, leaving each with a single empty
 * paragraph, and drops the selection. Returns false (leaving the command for
 * others) when the selection spans no cells.
 */
function $clearSelectedCells(selection: TableSelection): boolean {
  const cells = selection.getNodes().filter($isTableCellNode);
  if (cells.length === 0) return false;
  for (const cell of cells) {
    cell.clear();
    cell.append($createParagraphNode());
  }
  $setSelection(null);
  return true;
}

export function tableClipboardPlugin() {
  return (editor: LexicalEditor) => registerTableClipboardPlugin(editor);
}
