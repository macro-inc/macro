import { $createQuoteNode, $isQuoteNode } from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_NORMAL,
  type ElementNode,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';

function $testSelectionPosition(
  selection: RangeSelection,
  parent: ElementNode
) {
  return (
    selection.focus.type === 'text' &&
    selection.focus.offset === 0 &&
    selection.focus.getNode() === parent.getFirstChild()
  );
}

/**
 * Normalize enter at start of block elements.
 * QuoteNode - mirrors heading node behavior and notion.
 */
function $handleEnterAtBlockStart(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const selectionNode = selection.focus.getNode();

  const rootParent = selectionNode.getTopLevelElement();
  if (!rootParent) return false;

  if ($isQuoteNode(rootParent)) {
    if (rootParent.getTextContent() === '') {
      const paragraph = $createParagraphNode();
      rootParent.replace(paragraph);
      paragraph.selectStart();
      return true;
    }
    if ($testSelectionPosition(selection, rootParent)) {
      rootParent.insertBefore($createQuoteNode());
      return true;
    }
  }
  return false;
}

function registerNormalizeEnterPlugin(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }
        const res = $handleEnterAtBlockStart();
        if (res) event.preventDefault();
        return res;
      },
      COMMAND_PRIORITY_NORMAL
    )
  );
}

export function normalizeEnterPlugin() {
  return (editor: LexicalEditor) => {
    return registerNormalizeEnterPlugin(editor);
  };
}
