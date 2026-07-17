import { $isListItemNode } from '@lexical/list';
import { $isTableCellNode } from '@lexical/table';
import { $findMatchingParent } from '@lexical/utils';
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_CRITICAL,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  type LexicalEditor,
  OUTDENT_CONTENT_COMMAND,
} from 'lexical';

/**
 * The table selection observer claims Tab at HIGH priority to hop between
 * cells, which makes list indentation unreachable inside cells. Claim Tab
 * first when the caret is in a list item that can indent (or outdent, for
 * Shift+Tab), and fall through to cell navigation otherwise.
 */
export function registerTableListTab(editor: LexicalEditor) {
  return editor.registerCommand<KeyboardEvent>(
    KEY_TAB_COMMAND,
    (event) => {
      const selection = $getSelection();
      if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
        return false;
      }

      const listItem = $findMatchingParent(
        selection.anchor.getNode(),
        $isListItemNode
      );
      if (!listItem || !$findMatchingParent(listItem, $isTableCellNode)) {
        return false;
      }

      if (event.shiftKey) {
        if (listItem.getIndent() <= 0) return false;
        event.preventDefault();
        editor.dispatchCommand(OUTDENT_CONTENT_COMMAND, undefined);
        return true;
      }

      // Same depth limit as tabIndentationPlugin: at most one level deeper
      // than the previous sibling.
      const prevSibling = listItem.getPreviousSibling();
      const prevDepth = $isElementNode(prevSibling)
        ? prevSibling.getIndent()
        : 0;
      if (listItem.getIndent() >= prevDepth + 1) return false;

      event.preventDefault();
      editor.dispatchCommand(INDENT_CONTENT_COMMAND, undefined);
      return true;
    },
    COMMAND_PRIORITY_CRITICAL
  );
}
