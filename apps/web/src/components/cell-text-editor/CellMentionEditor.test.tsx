import { encodeCellMention } from '@macro-inc/spreadsheet/cell-mentions';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { CellMentionEditor } from './CellMentionEditor';
import { setCellTextCursor } from './cell-mention-dom';

afterEach(cleanup);

it('inserts a native mention inside mixed text and publishes the document encoding intact', async () => {
  const token = encodeCellMention({
    type: 'user',
    userId: 'macro|maya@example.com',
    email: 'maya@example.com',
    displayName: 'Maya',
  });
  const write = vi.fn();
  const key = vi.fn();
  const [value, setValue] = createSignal('Say hi to ');
  render(() => (
    <CellMentionEditor
      label="Edit Notes"
      value={value()}
      class=""
      autoFocus
      onInput={(value) => {
        write(value);
        setValue(value);
      }}
      onKeyDown={key}
      onBlur={vi.fn()}
      convertPaste={(value) => value}
      renderMenu={(_menu, _anchor, pick) => (
        <button onClick={() => pick(token)}>Maya</button>
      )}
    />
  ));
  const editor = screen.getByRole('textbox', { name: 'Edit Notes' });
  await waitFor(() => expect(document.activeElement).toBe(editor));
  editor.textContent = 'Say hi to @may';
  setCellTextCursor(editor, editor.textContent.length);
  fireEvent.input(editor);
  fireEvent.click(await screen.findByRole('button', { name: 'Maya' }));
  expect(value()).toBe(`Say hi to ${token} `);
  expect(editor.textContent).toBe('Say hi to @Maya ');
  expect(
    editor.querySelector<HTMLElement>('[data-cell-mention]')?.contentEditable
  ).toBe('false');
  expect(document.activeElement).toBe(editor);
  fireEvent.keyDown(editor, { key: 'Tab' });
  expect(key).toHaveBeenCalledTimes(1);
  expect(write).toHaveBeenLastCalledWith(`Say hi to ${token} `);
});

it('selects the full cell when requested and treats pasted HTML as text', async () => {
  render(() => (
    <CellMentionEditor
      label="Edit Notes"
      value="existing"
      class=""
      autoFocus
      selectAll
      onInput={vi.fn()}
      onKeyDown={vi.fn()}
      onBlur={vi.fn()}
      convertPaste={(value) => value}
      renderMenu={() => null}
    />
  ));
  const editor = screen.getByRole('textbox', { name: 'Edit Notes' });
  await waitFor(() => expect(document.activeElement).toBe(editor));
  expect(document.getSelection()?.toString()).toBe('existing');
  fireEvent.paste(editor, {
    clipboardData: { getData: () => '<script>alert(1)</script> **bold**' },
  });
  expect(editor.querySelector('script')).toBeNull();
  expect(editor.textContent).toBe('<script>alert(1)</script> **bold**');
});
