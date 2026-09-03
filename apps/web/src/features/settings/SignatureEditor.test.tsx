/**
 * @vitest-environment jsdom
 */

import { render, waitFor } from '@solidjs/testing-library';
import { describe, expect, it, vi } from 'vitest';
import SignatureEditor from './SignatureEditor';

describe('SignatureEditor', () => {
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
