/** @vitest-environment jsdom */

import { render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { Layout } from '../Layout';

it('preserves the editor, selection, file picker, and focused actions when the layout changes', async () => {
  const user = userEvent.setup();
  const [oneLineInput, setOneLineInput] = createSignal(true);
  render(() => (
    <Layout oneLineInput={oneLineInput()}>
      <Layout.Body>
        <Layout.Editor>
          <textarea aria-label="Message" />
        </Layout.Editor>
      </Layout.Body>
      <Layout.ActionsLeft>
        <input type="file" aria-label="Attachment" />
      </Layout.ActionsLeft>
      <Layout.ActionsRight>
        <button type="button">Send</button>
      </Layout.ActionsRight>
    </Layout>
  ));

  const editor = screen.getByRole<HTMLTextAreaElement>('textbox');
  const picker = screen.getByLabelText<HTMLInputElement>('Attachment');
  const send = screen.getByRole('button', { name: 'Send' });
  const file = new File(['draft'], 'draft.txt', { type: 'text/plain' });
  await user.upload(picker, file);
  await user.type(editor, 'Hello world');
  editor.setSelectionRange(2, 7);

  for (const next of [false, true]) {
    setOneLineInput(next);
    expect(screen.getByRole('textbox')).toBe(editor);
    expect(document.activeElement).toBe(editor);
    expect(editor.value).toBe('Hello world');
    expect([editor.selectionStart, editor.selectionEnd]).toEqual([2, 7]);
    expect(screen.getByLabelText('Attachment')).toBe(picker);
    expect(picker.files?.[0]).toBe(file);
  }

  send.focus();
  setOneLineInput(false);
  expect(screen.getByRole('button', { name: 'Send' })).toBe(send);
  expect(document.activeElement).toBe(send);
});
