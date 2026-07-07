import {
  $getClipboardDataFromSelection,
  copyToClipboard,
} from '@lexical/clipboard';
import {
  $isTableCellNode,
  $isTableSelection,
  type TableSelection,
} from '@lexical/table';
import { mergeRegister, objectKlassEquals } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $setSelection,
  COMMAND_PRIORITY_CRITICAL,
  CUT_COMMAND,
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  type LexicalEditor,
} from 'lexical';

/**
 * When a copied cell range is pasted into a table, the upstream
 * @lexical/table handler overlays it on the grid anchored at the cursor
 * cell, growing the table with new rows/columns when the range runs past
 * the edges. That growth is left as-is; this plugin only fixes cell
 * clearing on cut/delete.
 */
function registerTableClipboardPlugin(editor: LexicalEditor) {
  return registerTableCellClear(editor);
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
