import { match } from 'ts-pattern';
import { KEYSYM_BACKSPACE, KEYSYM_DELETE, KEYSYM_RETURN } from '../core/keysym';

/**
 * What the field holds between keystrokes. It is never empty, so a phone
 * keyboard's Backspace always has something to delete and fires
 * `beforeinput` (Android keyboards fire nothing on an empty field).
 */
export const TEXT_ENTRY_PLACEHOLDER = '​';

/** Android keyboards report most keys as this during composition. */
const KEY_CODE_COMPOSING = 229;

export type TextEntryOptions = {
  /** Committed text: typed characters, a finished IME composition, dictation, a paste. */
  onText: (text: string) => void;
  /** One key press (down and up) the field can't express as text. */
  onKey: (keysym: number) => void;
  onComposingChange?: (composing: boolean) => void;
};

/**
 * Turns a phone keyboard's edits of a text field into guest input. Plain
 * typing is taken from `beforeinput` and cancelled, so the field stays at the
 * placeholder; an IME composition (Japanese, Chinese, Korean, Android's
 * word-at-a-time keyboards) edits the field locally and is sent once, when it
 * commits. Keyboards that skip `beforeinput` are caught from `input` by
 * comparing the field with the placeholder.
 */
export function createTextEntry(options: TextEntryOptions) {
  let field: HTMLInputElement | undefined;
  let composing = false;

  const setComposing = (next: boolean) => {
    composing = next;
    options.onComposingChange?.(next);
  };

  const reset = () => {
    if (!field) return;
    field.value = TEXT_ENTRY_PLACEHOLDER;
    field.setSelectionRange(1, 1);
  };

  /** Sends what an uncancelled edit changed, then restores the placeholder. */
  const reconcile = () => {
    if (!field) return;
    const value = field.value;
    if (value === TEXT_ENTRY_PLACEHOLDER) return;
    if (!value.includes(TEXT_ENTRY_PLACEHOLDER)) {
      // The placeholder itself was deleted: one Backspace, plus anything typed over it.
      options.onKey(KEYSYM_BACKSPACE);
    }
    const typed = value.replaceAll(TEXT_ENTRY_PLACEHOLDER, '');
    if (typed) options.onText(typed);
    reset();
  };

  return {
    ref(element: HTMLInputElement) {
      field = element;
      reset();
    },
    onFocus: reset,
    onCompositionStart() {
      setComposing(true);
    },
    onCompositionEnd(event: CompositionEvent) {
      setComposing(false);
      if (event.data) options.onText(event.data);
      // The composed text is still in the field; drop it once the browser
      // has finished updating it.
      queueMicrotask(reset);
    },
    onBeforeInput(event: InputEvent) {
      // The IME edits its own text in the field until it commits.
      if (
        composing ||
        event.isComposing ||
        event.inputType === 'insertCompositionText'
      ) {
        return;
      }
      // Not cancellable (some Android keyboards): it lands, and `input` reconciles.
      if (!event.cancelable) return;
      const keysym = match(event.inputType)
        .with(
          'insertText',
          'insertReplacementText',
          'insertFromPaste',
          'insertFromDrop',
          () => {
            const text =
              event.data ?? event.dataTransfer?.getData('text/plain') ?? '';
            if (text) options.onText(text);
            return null;
          }
        )
        .with(
          'deleteContentBackward',
          'deleteWordBackward',
          () => KEYSYM_BACKSPACE
        )
        .with('deleteContentForward', 'deleteWordForward', () => KEYSYM_DELETE)
        .with('insertLineBreak', 'insertParagraph', () => KEYSYM_RETURN)
        .otherwise(() => undefined);
      // Anything else lands in the field, and `input` reconciles it.
      if (keysym === undefined) return;
      event.preventDefault();
      if (keysym !== null) options.onKey(keysym);
    },
    onInput() {
      if (composing) return;
      reconcile();
    },
    onKeyDown(event: KeyboardEvent) {
      // Enter that confirms an IME candidate is not a Return for the guest.
      if (event.isComposing || event.keyCode === KEY_CODE_COMPOSING) return;
      // A single-line field gets no line-break `beforeinput`, so Enter is a key.
      if (event.key === 'Enter') {
        event.preventDefault();
        options.onKey(KEYSYM_RETURN);
      }
    },
  };
}
