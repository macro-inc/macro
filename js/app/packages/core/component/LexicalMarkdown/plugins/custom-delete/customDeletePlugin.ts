import { $isListItemNode } from '@lexical/list';
import { $setBlocksType } from '@lexical/selection';
import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import {
  $createParagraphNode,
  $getSelection,
  $isRangeSelection,
  COMMAND_PRIORITY_LOW,
  DELETE_CHARACTER_COMMAND,
  DELETE_LINE_COMMAND,
  DELETE_WORD_COMMAND,
  type LexicalEditor,
} from 'lexical';

/**
 * Change a list item with text into a paragraph node.
 * Only in the case that (a) we hit call DELETE from the first selection
 *     position of a list item node.
 * @returns true if a ParagraphNode was inserted successfully, false otherwise
 */
export function $handleDeleteListItemAtStart(): boolean {
  // this is the lexical handler for hitting 'ENTER' from an empty list item.
  // if that returns true, we are already done.
  const selection = $getSelection();

  // only collapsed selections.
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) {
    return false;
  }

  // only inside list items.
  const anchor = selection.anchor.getNode();
  const listItemNode = $findMatchingParent(anchor, $isListItemNode);
  if (!listItemNode) {
    return false;
  }

  // only at the very start.
  let isAtStart = false;
  if (selection.anchor.offset === 0) {
    if (anchor === listItemNode || anchor === listItemNode.getFirstChild()) {
      isAtStart = true;
    }
  }
  if (!isAtStart) {
    return false;
  }

  // turn into a paragraph.
  $setBlocksType(selection, () => $createParagraphNode());
  return true;
}

function registerCustomDeletePlugin(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerCommand(
      DELETE_LINE_COMMAND,
      () => {
        if ($handleDeleteListItemAtStart()) return true;
        return false;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerCommand(
      DELETE_CHARACTER_COMMAND,
      () => {
        if ($handleDeleteListItemAtStart()) return true;
        return false;
      },
      COMMAND_PRIORITY_LOW
    ),

    editor.registerCommand(
      DELETE_WORD_COMMAND,
      () => {
        if ($handleDeleteListItemAtStart()) return true;
        return false;
      },
      COMMAND_PRIORITY_LOW
    )
  );
}

/**
 * This plug in handles a custom backspace/delete behavior.
 * 1) Make delete call the same internal logic that enter does for empty list
 *    items.
 * 2) If the caret is at the first position of en element and that
 *    element is a list item – convert it to a paragraph.
 * 2) TODO (seamus) : Fix issue with over-deleting decorator nodes.
 */
export function customDeletePlugin() {
  return (editor: LexicalEditor) => {
    return registerCustomDeletePlugin(editor);
  };
}
