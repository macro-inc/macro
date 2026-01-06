import { $createQuoteNode, $isQuoteNode } from '@lexical/rich-text';
import { mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isElementNode,
  $isLineBreakNode,
  $isParagraphNode,
  $isRangeSelection,
  $isRootNode,
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_NORMAL,
  type ElementNode,
  KEY_ENTER_COMMAND,
  type LexicalEditor,
  type RangeSelection,
} from 'lexical';
import { isEmptyOrMatches } from '../../utils';

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
 * Returns true if the selection is at the start of an empty paragraph or is
 * directly preceded by a line break.
 */
export function $isAtStartOfEmptyParagraph(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  const node = selection.anchor.getNode();
  const parentElement = node.getParent();

  // check for preceding line break node
  if (selection.anchor.type === 'element') {
    if ($isElementNode(node)) {
      const offsetNode = node.getChildAtIndex(selection.anchor.offset);
      if ($isLineBreakNode(offsetNode)) {
        return true;
      }
    }
  }

  if (selection.anchor.offset !== 0) {
    return false;
  }

  if ($isParagraphNode(parentElement)) {
    return isEmptyOrMatches(parentElement.getTextContent().trim(), /^$/);
  }
  if ($isRootNode(parentElement)) {
    return isEmptyOrMatches(node.getTextContent().trim(), /^$/);
  }
  return false;
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
      (event) => {
        if (!event) return false;
        if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) {
          return false;
        }
        const res = $handleEnterAtBlockStart();
        if (res) event.preventDefault();
        return res;
      },
      COMMAND_PRIORITY_NORMAL
    ),

    editor.registerCommand(
      KEY_ENTER_COMMAND,
      (e) => {
        if (e?.shiftKey) {
          if ($isAtStartOfEmptyParagraph()) {
            e.preventDefault();
            editor.dispatchCommand(KEY_ENTER_COMMAND, null);
            return true;
          }
        }
        return false;
      },
      COMMAND_PRIORITY_LOW
    )
  );
}

export function normalizeEnterPlugin() {
  return (editor: LexicalEditor) => {
    return registerNormalizeEnterPlugin(editor);
  };
}
