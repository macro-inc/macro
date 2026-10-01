import type { LexicalEditor } from 'lexical';

/** Trigger before text insertion, including Android's Unidentified key events. */
export function registerInlineMenuTrigger(
  editor: LexicalEditor,
  symbol: string,
  onTrigger: () => void
) {
  let handledKeyDown = false;
  const keyDown = (event: KeyboardEvent) => {
    handledKeyDown = event.key === symbol;
    if (handledKeyDown) onTrigger();
  };
  const reset = () => {
    handledKeyDown = false;
  };
  const beforeInput = (event: InputEvent) => {
    const alreadyHandled = handledKeyDown;
    reset();
    if (
      !alreadyHandled &&
      event.inputType === 'insertText' &&
      event.data === symbol &&
      !event.isComposing &&
      !event.defaultPrevented
    ) {
      onTrigger();
    }
  };

  return editor.registerRootListener((root, previous) => {
    reset();
    if (previous) {
      previous.removeEventListener('keydown', keyDown);
      previous.removeEventListener('keyup', reset);
      previous.removeEventListener('beforeinput', beforeInput, true);
    }
    if (root) {
      root.addEventListener('keydown', keyDown);
      root.addEventListener('keyup', reset);
      // Validate the caret before Lexical inserts the trigger character.
      root.addEventListener('beforeinput', beforeInput, true);
    }
  });
}
