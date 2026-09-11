import { isIOS } from '@solid-primitives/platform';
import { type LexicalEditor, SKIP_SCROLL_INTO_VIEW_TAG } from 'lexical';

export function clearComposer(editor: LexicalEditor, clear: () => void) {
  const root = editor.getRootElement();
  if (!isIOS || !root || root.ownerDocument.activeElement !== root) {
    clear();
    return;
  }

  // End iOS dictation before clearing so its buffer cannot restore sent text.
  // Commit the clear before restoring selection, in the same task: leaving
  // focus unset until rAF lets the keyboard hide and changes the chat viewport.
  // It also makes the touchend focus-preservation handler skip the send tap.
  root.blur();
  editor.update(clear, { discrete: true });
  root.focus({ preventScroll: true });
  // Lexical also scrolls the restored caret, separately from DOM focus.
  editor.update(() => editor.focus(), { tag: SKIP_SCROLL_INTO_VIEW_TAG });
}
