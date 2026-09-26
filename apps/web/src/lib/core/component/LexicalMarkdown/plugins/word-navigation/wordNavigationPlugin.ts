import { $findMatchingParent, mergeRegister } from '@lexical/utils';
import { $isSelectionInsideCode } from '@macro-inc/lexical-core';
import {
  $getSelection,
  $isDecoratorNode,
  $isElementNode,
  $isRangeSelection,
  COMMAND_PRIORITY_HIGH,
  type ElementNode,
  IS_APPLE,
  type LexicalEditor,
  MOVE_TO_END,
  MOVE_TO_START,
} from 'lexical';

function $leadingInlineDecorator(block: ElementNode | null) {
  const first = block?.getFirstChild() ?? null;
  if (!$isDecoratorNode(first) || !first.isInline()) return null;
  return first;
}

function $focusBlock() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || $isSelectionInsideCode(selection)) {
    return null;
  }
  return $findMatchingParent(
    selection.focus.getNode(),
    (node): node is ElementNode => $isElementNode(node) && !node.isInline()
  );
}

/**
 * Ctrl+Left and Ctrl+Right move by word. Lexical reports those keys as
 * MOVE_TO_START and MOVE_TO_END, and the rich-text handlers then pin the
 * caret to the block edge when the block opens with an inline decorator.
 * Swallow those commands so the browser keeps moving by word.
 *
 * Firefox will not step backward out of the text node that follows a
 * contenteditable=false chip, so from that offset move the caret to before
 * the chip.
 *
 * On Apple, Cmd+Left and Cmd+Right move to the line edge. Those stay with
 * the rich-text handlers, which can place the caret before a
 * contenteditable=false chip when the browser will not.
 */
export function wordNavigationPlugin() {
  return (editor: LexicalEditor) => {
    return mergeRegister(
      editor.registerCommand(
        MOVE_TO_START,
        (event) => {
          if (IS_APPLE) return false;
          const block = $focusBlock();
          const decorator = $leadingInlineDecorator(block);
          if (!decorator || !block) return false;
          const selection = $getSelection();
          const next = decorator.getNextSibling();
          if (
            $isRangeSelection(selection) &&
            selection.isCollapsed() &&
            next !== null &&
            selection.anchor.getNode().is(next) &&
            selection.anchor.offset === 0
          ) {
            event.preventDefault();
            selection.focus.set(block.getKey(), 0, 'element');
            if (!event.shiftKey) {
              selection.anchor.set(block.getKey(), 0, 'element');
            }
            return true;
          }
          return true;
        },
        COMMAND_PRIORITY_HIGH
      ),
      editor.registerCommand(
        MOVE_TO_END,
        () => {
          if (IS_APPLE) return false;
          const selection = $getSelection();
          if (
            !$isRangeSelection(selection) ||
            $isSelectionInsideCode(selection)
          ) {
            return false;
          }
          const { anchor } = selection;
          if (anchor.type !== 'element' || anchor.offset !== 0) return false;
          const element = anchor.getNode();
          if (!$isElementNode(element) || element.isInline()) return false;
          return $leadingInlineDecorator(element) !== null;
        },
        COMMAND_PRIORITY_HIGH
      )
    );
  };
}
