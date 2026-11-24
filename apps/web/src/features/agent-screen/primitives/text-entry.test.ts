import { describe, expect, it } from 'vitest';
import { createTextEntry, TEXT_ENTRY_PLACEHOLDER } from './text-entry';

const BACKSPACE = 0xff08;
const RETURN = 0xff0d;

function beforeInput(
  inputType: string,
  data: string | null,
  isComposing = false
) {
  return new InputEvent('beforeinput', {
    inputType,
    data,
    isComposing,
    cancelable: true,
  });
}

describe('createTextEntry', () => {
  it('sends typing, a committed IME composition, Backspace on an empty field and Enter', async () => {
    const sent: (string | number)[] = [];
    const entry = createTextEntry({
      onText: (text) => sent.push(text),
      onKey: (keysym) => sent.push(keysym),
    });
    const field = document.createElement('input');
    entry.ref(field);
    expect(field.value).toBe(TEXT_ENTRY_PLACEHOLDER);

    // Latin typing is taken from beforeinput and cancelled.
    const typed = beforeInput('insertText', 'h');
    entry.onBeforeInput(typed);
    expect(typed.defaultPrevented).toBe(true);

    // A Japanese IME: its own edits stay local until it commits.
    entry.onCompositionStart();
    const composing = beforeInput('insertCompositionText', 'にほ', true);
    entry.onBeforeInput(composing);
    expect(composing.defaultPrevented).toBe(false);
    field.value = `${TEXT_ENTRY_PLACEHOLDER}にほ`;
    entry.onInput();
    // Enter that picks the candidate is not a Return.
    entry.onKeyDown(
      new KeyboardEvent('keydown', { key: 'Enter', isComposing: true })
    );
    field.value = `${TEXT_ENTRY_PLACEHOLDER}日本`;
    entry.onCompositionEnd(
      new CompositionEvent('compositionend', { data: '日本' })
    );
    await Promise.resolve();
    expect(field.value).toBe(TEXT_ENTRY_PLACEHOLDER);

    // Backspace with nothing typed still reaches the guest.
    const deleted = beforeInput('deleteContentBackward', null);
    entry.onBeforeInput(deleted);
    expect(deleted.defaultPrevented).toBe(true);

    entry.onKeyDown(new KeyboardEvent('keydown', { key: 'Enter' }));

    expect(sent).toEqual(['h', '日本', BACKSPACE, RETURN]);
  });

  it('reconciles keyboards that change the field without a cancellable beforeinput', () => {
    const sent: (string | number)[] = [];
    const entry = createTextEntry({
      onText: (text) => sent.push(text),
      onKey: (keysym) => sent.push(keysym),
    });
    const field = document.createElement('input');
    entry.ref(field);

    entry.onBeforeInput(
      new InputEvent('beforeinput', {
        inputType: 'insertText',
        data: 'é',
        cancelable: false,
      })
    );
    field.value = `${TEXT_ENTRY_PLACEHOLDER}é`;
    entry.onInput();

    // An old Android keyboard deleting the placeholder itself.
    field.value = '';
    entry.onInput();

    expect(sent).toEqual(['é', BACKSPACE]);
    expect(field.value).toBe(TEXT_ENTRY_PLACEHOLDER);
  });
});
