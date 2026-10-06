import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { FormOption } from '../../core/form-model';
import { DraftInput } from './draft-input';
import { OptionListEditor } from './option-list-editor';

afterEach(cleanup);

describe('DraftInput', () => {
  it('keeps what the person is typing when the value changes underneath, and commits it on blur', () => {
    const [value, setValue] = createSignal('Untitled question');
    const committed: string[] = [];
    render(() => (
      <DraftInput
        aria-label="Question"
        value={value()}
        onCommit={(next) => {
          committed.push(next);
        }}
      />
    ));
    const input = screen.getByLabelText<HTMLInputElement>('Question');
    input.focus();
    fireEvent.input(input, { target: { value: 'Will you attend?' } });
    // A read of the table answers while the person is still typing.
    setValue('Untitled question 2');
    expect(input.value).toBe('Will you attend?');
    input.blur();
    expect(committed).toEqual(['Will you attend?']);
    setValue('Will you attend?');
    expect(input.value).toBe('Will you attend?');
  });

  it('follows the value while not focused, and Escape puts it back', () => {
    const [value, setValue] = createSignal('Name');
    const committed: string[] = [];
    render(() => (
      <DraftInput
        aria-label="Question"
        value={value()}
        onCommit={(next) => {
          committed.push(next);
        }}
      />
    ));
    const input = screen.getByLabelText<HTMLInputElement>('Question');
    setValue('Full name');
    expect(input.value).toBe('Full name');
    input.focus();
    fireEvent.input(input, { target: { value: 'Nickname' } });
    fireEvent.keyDown(input, { key: 'Escape' });
    expect(input.value).toBe('Full name');
    expect(committed).toEqual([]);
  });
});

describe('OptionListEditor', () => {
  it('keeps an option row and its draft mounted when a read replaces the options', () => {
    const [options, setOptions] = createSignal<readonly FormOption[]>([
      { id: 'option-1', label: 'Option 1', color: null },
    ]);
    const renamed: string[] = [];
    render(() => (
      <OptionListEditor
        options={options()}
        multi={false}
        onAdd={async () => true}
        onRename={(_, label) => renamed.push(label)}
        onRecolor={() => {}}
        onDelete={() => {}}
      />
    ));
    const first = screen.getByLabelText<HTMLInputElement>('Option 1');
    first.focus();
    fireEvent.input(first, { target: { value: 'Ye' } });
    setOptions([
      { id: 'option-1', label: 'Option 1', color: null },
      { id: 'option-2', label: 'No', color: null },
    ]);
    expect(screen.getByLabelText<HTMLInputElement>('Option 1')).toBe(first);
    expect(first.value).toBe('Ye');
    expect(document.activeElement).toBe(first);
  });

  it('puts the new option’s text back when adding it fails', async () => {
    let answer: (added: boolean) => void = () => {};
    const adding = new Promise<boolean>((resolve) => {
      answer = resolve;
    });
    render(() => (
      <OptionListEditor
        options={[{ id: 'option-1', label: 'Yes', color: null }]}
        multi={false}
        onAdd={() => adding}
        onRename={() => {}}
        onRecolor={() => {}}
        onDelete={() => {}}
      />
    ));
    const add = screen.getByLabelText<HTMLInputElement>('Add option');
    fireEvent.input(add, { target: { value: 'No' } });
    fireEvent.keyDown(add, { key: 'Enter' });
    expect(add.value).toBe('');
    answer(false);
    // The editor awaits the same promise, and its continuation runs first.
    await adding;
    expect(add.value).toBe('No');
  });
});
