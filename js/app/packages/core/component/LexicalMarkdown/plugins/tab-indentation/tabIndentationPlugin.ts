/**
 * @file Indent and outdent nodes. Overrides default rich-text tab behavior.
 * TODO (seamus): implement contextual max indent depth per node in the selection.
 */

import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import type { ElementNode, LexicalCommand, LexicalEditor } from 'lexical';
import {
  $getSelection,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_EDITOR,
  COMMAND_PRIORITY_LOW,
  INDENT_CONTENT_COMMAND,
  KEY_TAB_COMMAND,
  OUTDENT_CONTENT_COMMAND,
} from 'lexical';

const UnindentableBlocks = new Set(['code', 'quote', 'heading']);

function indent(block: ElementNode) {
  const indent = block.getIndent();
  block.setIndent(indent + 1);
}

function getPreviousSiblingDepth(node: ElementNode): number {
  const prevSibling = node.getPreviousSibling();
  if ($isElementNode(prevSibling)) {
    return prevSibling.getIndent();
  }
  return 0;
}

function $handleIndentWithLimit(): boolean {
  const selection = $getSelection();
  if (!$isRangeSelection(selection)) {
    return false;
  }
  const alreadyHandled = new Set();
  const nodes = selection.getNodes();
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const key = node.getKey();
    if (alreadyHandled.has(key)) {
      continue;
    }
    const parentBlock = $findMatchingParent(
      node,
      (parentNode): parentNode is ElementNode =>
        $isElementNode(parentNode) && !parentNode.isInline()
    ) as ElementNode | null;

    if (parentBlock === null) {
      continue;
    }

    const parentKey = parentBlock.getKey();

    if (alreadyHandled.has(parentKey) || !parentBlock.canIndent()) {
      continue;
    }

    alreadyHandled.add(parentKey);
    if (UnindentableBlocks.has(parentBlock.getType())) continue;

    const depth = parentBlock.getIndent();
    const previousSiblingDepth = getPreviousSiblingDepth(parentBlock);
    if (depth >= previousSiblingDepth + 1) {
      continue;
    }
    indent(parentBlock);
  }
  return alreadyHandled.size > 0;
}

function registerTabIndentation(editor: LexicalEditor) {
  return mergeRegister(
    editor.registerCommand<KeyboardEvent>(
      KEY_TAB_COMMAND,
      (event) => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          return false;
        }

        event.preventDefault();
        const command: LexicalCommand<void> = event.shiftKey
          ? OUTDENT_CONTENT_COMMAND
          : INDENT_CONTENT_COMMAND;
        return editor.dispatchCommand(command, undefined);
      },
      COMMAND_PRIORITY_EDITOR
    ),

    /**
     * Override the defualt indentation behavior to handle indentation with limit.
     */
    editor.registerCommand(
      INDENT_CONTENT_COMMAND,
      () => $handleIndentWithLimit(),
      COMMAND_PRIORITY_LOW
    )
  );
}

export function tabIndentationPlugin() {
  return (editor: LexicalEditor) => {
    return registerTabIndentation(editor);
  };
}
