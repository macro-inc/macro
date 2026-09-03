/**
 * @vitest-environment jsdom
 */

import { render, waitFor } from '@solidjs/testing-library';
import Quill from 'quill';
import { describe, expect, it, vi } from 'vitest';
import SignatureEditor from './SignatureEditor';

describe('SignatureEditor', () => {
  it('calls onInput with the HTML when the user edits', async () => {
    const onInput = vi.fn();
    render(() => <SignatureEditor value="" onInput={onInput} />);

    const quill = await waitFor(() => {
      const container = document.querySelector('.ql-container');
      const instance = container ? Quill.find(container) : null;
      if (!instance || typeof instance === 'symbol') {
        throw new Error('Quill is not mounted');
      }
      return instance;
    });

    quill.insertText(0, 'Hello', 'user');
    expect(onInput).toHaveBeenCalled();
    expect(String(onInput.mock.calls[0]?.[0])).toContain('Hello');
  });

  it('does not call onInput when setContent is silent', async () => {
    const onInput = vi.fn();
    let handle: { setContent: (html: string) => void } | undefined;

    render(() => (
      <SignatureEditor
        value=""
        onInput={onInput}
        onReady={(api) => {
          handle = api;
        }}
      />
    ));

    await waitFor(() => expect(handle).toBeDefined());
    onInput.mockClear();
    handle?.setContent('<p>Hello</p>');
    expect(onInput).not.toHaveBeenCalled();
  });
});
