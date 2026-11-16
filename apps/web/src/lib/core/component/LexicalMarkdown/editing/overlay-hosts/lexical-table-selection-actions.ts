import {
  $getClipboardDataFromSelection,
  $insertDataTransferForRichText,
} from '@lexical/clipboard';
import {
  $getTableCellNodeFromLexicalNode,
  $isTableCellNode,
  $isTableSelection,
  $mergeCells,
  $unmergeCell,
} from '@lexical/table';
import {
  $getNodeByKey,
  $getSelection,
  $isRangeSelection,
  $setSelection,
  BLUR_COMMAND,
  COMMAND_PRIORITY_LOW,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
  SELECTION_CHANGE_COMMAND,
} from 'lexical';
import type { Accessor } from 'solid-js';
import type {
  TableSelectionActionsHost,
  TableSelectionCells,
} from './table-selection-actions';

const noop = () => {};

/** Source TableSelectionActionBar backend over the surrounding Lexical editor. */
export function createLexicalTableSelectionActionsHost(
  editor: Accessor<LexicalEditor | undefined>
): TableSelectionActionsHost<string> {
  return {
    tracked() {
      const currentEditor = editor();
      if (!currentEditor) return;
      return currentEditor.read((): TableSelectionCells<string> | undefined => {
        const selection = $getSelection();
        if (!$isTableSelection(selection)) return;
        // Use $getNodeByKey to avoid throws when nodes were just removed (e.g. post-merge).
        const anchorNode = $getNodeByKey(selection.anchor.key);
        const focusNode = $getNodeByKey(selection.focus.key);
        if (!anchorNode || !focusNode) return;
        const anchorCell = $getTableCellNodeFromLexicalNode(anchorNode);
        const focusCell = $getTableCellNodeFromLexicalNode(focusNode);
        const cells = selection.getNodes().filter($isTableCellNode);
        return {
          anchor: anchorCell?.getKey(),
          focus: focusCell?.getKey(),
          merged: cells.some((c) => c.getColSpan() > 1 || c.getRowSpan() > 1),
        };
      });
    },
    registerSelection(listener) {
      return (
        editor()?.registerCommand(
          SELECTION_CHANGE_COMMAND,
          () => {
            listener();
            return false;
          },
          COMMAND_PRIORITY_LOW
        ) ?? noop
      );
    },
    registerLayout(listener) {
      return (
        editor()?.registerUpdateListener(() => {
          listener();
        }) ?? noop
      );
    },
    registerBlur(listener) {
      return (
        editor()?.registerCommand(
          BLUR_COMMAND,
          () => {
            listener();
            return false;
          },
          COMMAND_PRIORITY_LOW
        ) ?? noop
      );
    },
    elementFor(key) {
      return editor()?.getElementByKey(key) ?? undefined;
    },
    clipboardData() {
      const currentEditor = editor();
      if (!currentEditor) return null;
      return currentEditor.read(() => {
        const selection = $getSelection();
        return $isTableSelection(selection)
          ? $getClipboardDataFromSelection(selection)
          : null;
      });
    },
    clearCells() {
      // The same path as backspacing a table selection ($clearText), which
      // also collapses the selection.
      editor()?.dispatchCommand(
        KEY_BACKSPACE_COMMAND,
        new KeyboardEvent('keydown', { key: 'Backspace' })
      );
    },
    clearSelection() {
      editor()?.update(() => $setSelection(null));
    },
    merge() {
      editor()?.update(() => {
        const selection = $getSelection();
        if (!$isTableSelection(selection)) return;
        $mergeCells(selection.getNodes().filter($isTableCellNode));
        $setSelection(null);
      });
    },
    split() {
      editor()?.update(() => {
        $unmergeCell();
        $setSelection(null);
      });
    },
    paste(dataTransfer) {
      const currentEditor = editor();
      if (!currentEditor) return;
      currentEditor.update(() => {
        const selection = $getSelection();
        if (!$isTableSelection(selection) && !$isRangeSelection(selection)) {
          return;
        }
        $insertDataTransferForRichText(dataTransfer, selection, currentEditor);
        $setSelection(null);
      });
    },
  };
}
