import {
  $getSelection,
  $isRangeSelection,
  $isTextNode,
  COMMAND_PRIORITY_LOW,
  IS_IOS,
  KEY_BACKSPACE_COMMAND,
  type LexicalEditor,
} from 'lexical';

function $isCaretInsideText() {
  const selection = $getSelection();
  if (!$isRangeSelection(selection) || !selection.isCollapsed()) return false;
  return $isTextNode(selection.anchor.getNode()) && selection.anchor.offset > 0;
}

/**
 * The rich-text Backspace handler cancels the keydown and deletes one
 * character. On iOS that also cancels the keyboard's own deletion: the whole
 * word after glide typing, and the speed-up while Backspace is held. Both
 * arrive as `beforeinput` events (a word-sized target range, or
 * `deleteWordBackward`) that Lexical already applies, so let the keydown
 * through while the caret is inside text. Block boundaries keep Lexical's
 * handling for list items, indentation, and decorators.
 */
export function nativeIosBackspacePlugin() {
  return (editor: LexicalEditor) => {
    if (!IS_IOS) return () => {};
    return editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      $isCaretInsideText,
      COMMAND_PRIORITY_LOW
    );
  };
}
