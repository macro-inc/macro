/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiKeyInput } from './ApiKeyInput';

afterEach(cleanup);

describe('ApiKeyInput', () => {
  it('masks a saved key and reports what is typed and Enter', () => {
    const onValueChange = vi.fn();
    const onSubmit = vi.fn();
    const { getByLabelText } = render(() => (
      <ApiKeyInput
        prefix="sk-ant-"
        saved
        value=""
        onValueChange={onValueChange}
        onSubmit={onSubmit}
        aria-label="Anthropic API key"
      />
    ));
    const input = getByLabelText('Anthropic API key') as HTMLInputElement;

    expect(input.type).toBe('password');
    expect(input.placeholder).toBe('sk-ant-••••••••••••');
    expect(input.autocomplete).toBe('off');
    fireEvent.input(input, { target: { value: 'sk-ant-api03-new' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(onValueChange).toHaveBeenCalledWith('sk-ant-api03-new');
    expect(onSubmit).toHaveBeenCalledOnce();
  });

  it('shows the provider prefix before a key is saved', () => {
    const { getByLabelText } = render(() => (
      <ApiKeyInput
        prefix="sk-"
        value=""
        onValueChange={() => {}}
        aria-label="OpenAI API key"
      />
    ));

    expect(
      (getByLabelText('OpenAI API key') as HTMLInputElement).placeholder
    ).toBe('sk-…');
  });
});
