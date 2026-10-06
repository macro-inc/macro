import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { LiveTextarea, LiveTextInput } from './live-text-input';

afterEach(cleanup);

/** A title shared with another editor; `onEdit` writes it as the builder does. */
function mountTitle(initial: string, accept = true) {
  const [value, setValue] = createSignal(initial);
  const edits: string[] = [];
  render(() => (
    <LiveTextInput
      aria-label="Section title"
      value={value()}
      onEdit={(next) => {
        edits.push(next);
        if (accept) setValue(next);
        return accept;
      }}
    />
  ));
  const input = screen.getByLabelText<HTMLInputElement>('Section title');
  return { input, edits, setValue };
}

/** The person types: the browser changes the text and moves the caret. */
function type(input: HTMLInputElement, text: string, caret: number) {
  input.value = text;
  input.setSelectionRange(caret, caret);
  fireEvent.input(input, { inputType: 'insertText' });
}

describe('LiveTextInput', () => {
  it('keeps the caret on its text when another editor changes text before it', () => {
    const { input, setValue } = mountTitle('Introduction');
    input.focus();
    input.setSelectionRange(5, 5);
    setValue('Updated introduction');
    expect(input.value).toBe('Updated introduction');
    expect([input.selectionStart, input.selectionEnd]).toEqual([13, 13]);
    expect(document.activeElement).toBe(input);
  });

  it('leaves the selection alone when text is inserted after it', () => {
    const { input, setValue } = mountTitle('Hello world');
    input.focus();
    input.setSelectionRange(0, 5);
    setValue('Hello world, again');
    expect(input.value).toBe('Hello world, again');
    expect([input.selectionStart, input.selectionEnd]).toEqual([0, 5]);
  });

  it('shrinks the selection when another editor deletes or replaces through it', () => {
    const { input, setValue } = mountTitle('Hello brave world');
    input.focus();
    input.setSelectionRange(6, 17);
    setValue('Hello boldrld');
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 13]);
    setValue('Hello');
    expect([input.selectionStart, input.selectionEnd]).toEqual([5, 5]);
  });

  it('keeps a backward selection backward', () => {
    const { input, setValue } = mountTitle('Hello world');
    input.focus();
    input.setSelectionRange(6, 11, 'backward');
    setValue('Oh, hello world');
    expect([input.selectionStart, input.selectionEnd]).toEqual([10, 15]);
    expect(input.selectionDirection).toBe('backward');
  });

  it('follows the value while unfocused without taking focus', () => {
    const { input, setValue } = mountTitle('Draft');
    setValue('Final');
    expect(input.value).toBe('Final');
    expect(document.activeElement).not.toBe(input);
  });

  it('writes each keystroke and keeps what was typed', () => {
    const { input, edits } = mountTitle('Intro');
    input.focus();
    type(input, 'Intros', 6);
    expect(edits).toEqual(['Intros']);
    expect(input.value).toBe('Intros');
    expect([input.selectionStart, input.selectionEnd]).toEqual([6, 6]);
  });

  it('puts the saved text back, caret kept, when an edit is refused', () => {
    const { input, edits } = mountTitle('Intro', false);
    input.focus();
    type(input, 'InXtro', 3);
    expect(edits).toEqual(['InXtro']);
    expect(input.value).toBe('Intro');
    expect([input.selectionStart, input.selectionEnd]).toEqual([2, 2]);
  });

  it('never touches text still being composed, then keeps both edits', () => {
    const { input, edits, setValue } = mountTitle('hello');
    input.focus();
    input.setSelectionRange(5, 5);
    fireEvent.compositionStart(input);
    input.value = 'hello にほ';
    input.setSelectionRange(8, 8);
    fireEvent.input(input, { isComposing: true });
    expect(edits).toEqual([]);
    // Another editor capitalises the title mid-composition.
    setValue('Hello');
    expect(input.value).toBe('hello にほ');
    expect([input.selectionStart, input.selectionEnd]).toEqual([8, 8]);
    input.value = 'hello 日本';
    input.setSelectionRange(8, 8);
    fireEvent.compositionEnd(input);
    expect(edits).toEqual(['Hello 日本']);
    expect(input.value).toBe('Hello 日本');
    expect([input.selectionStart, input.selectionEnd]).toEqual([8, 8]);
    // The input event some browsers send after composition writes nothing new.
    fireEvent.input(input, { isComposing: false });
    expect(edits).toEqual(['Hello 日本']);
  });
});

describe('LiveTextarea', () => {
  it('keeps the caret on its line when another editor edits above it', () => {
    const [value, setValue] = createSignal('Sorry.\nTry again later.');
    render(() => (
      <LiveTextarea
        aria-label="Message when a rule fails"
        value={value()}
        onEdit={(next) => {
          setValue(next);
          return true;
        }}
      />
    ));
    const textarea = screen.getByLabelText<HTMLTextAreaElement>(
      'Message when a rule fails'
    );
    textarea.focus();
    textarea.setSelectionRange(10, 10);
    setValue('Sorry, no.\nTry again later.');
    expect(textarea.value).toBe('Sorry, no.\nTry again later.');
    expect([textarea.selectionStart, textarea.selectionEnd]).toEqual([14, 14]);
  });
});
