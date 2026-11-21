/** @vitest-environment jsdom */

import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SECRET_MASK, SecretInput } from './SecretInput';

afterEach(cleanup);

describe('SecretInput', () => {
  it('masks what is typed and reveals it only on request', () => {
    const [value, setValue] = createSignal('');
    const { getByLabelText, queryByRole, getByRole } = render(() => (
      <SecretInput
        aria-label="IMAP password"
        autocomplete="current-password"
        value={value()}
        onValueChange={setValue}
      />
    ));
    const input = getByLabelText('IMAP password') as HTMLInputElement;

    expect(input.type).toBe('password');
    expect(queryByRole('button', { name: 'Show what you typed' })).toBeNull();

    fireEvent.input(input, { target: { value: 'hunter2' } });
    expect(value()).toBe('hunter2');
    expect(input.type).toBe('password');

    fireEvent.click(getByRole('button', { name: 'Show what you typed' }));
    expect(input.type).toBe('text');

    fireEvent.click(getByRole('button', { name: 'Hide what you typed' }));
    expect(input.type).toBe('password');
  });

  it('masks again once the field is cleared, as after a save', () => {
    const [value, setValue] = createSignal('');
    const { getByLabelText, getByRole } = render(() => (
      <SecretInput
        aria-label="Token"
        autocomplete="off"
        value={value()}
        onValueChange={setValue}
      />
    ));
    const input = getByLabelText('Token') as HTMLInputElement;

    fireEvent.input(input, { target: { value: 'first' } });
    fireEvent.click(getByRole('button', { name: 'Show what you typed' }));
    expect(input.type).toBe('text');

    setValue('');
    expect(input.type).toBe('password');
    fireEvent.input(input, { target: { value: 'second' } });
    expect(input.type).toBe('password');
  });

  it('shows a stored secret only as a mask, with nothing to reveal', () => {
    const { getByLabelText, queryByRole } = render(() => (
      <SecretInput
        aria-label="API key"
        autocomplete="new-password"
        saved
        value=""
        onValueChange={() => {}}
      />
    ));
    const input = getByLabelText('API key') as HTMLInputElement;

    expect(input.value).toBe('');
    expect(input.placeholder).toBe(SECRET_MASK);
    expect(queryByRole('button')).toBeNull();
  });

  it('takes autocomplete from the context and stays out of replay and spellcheck', () => {
    const { getByLabelText } = render(() => (
      <>
        <SecretInput
          aria-label="New"
          autocomplete="new-password"
          value=""
          onValueChange={() => {}}
        />
        <SecretInput
          aria-label="Sign in"
          autocomplete="current-password"
          value=""
          onValueChange={() => {}}
        />
        <SecretInput
          aria-label="Other"
          autocomplete="off"
          value=""
          onValueChange={() => {}}
        />
      </>
    ));

    expect(getByLabelText('New').getAttribute('autocomplete')).toBe(
      'new-password'
    );
    expect(getByLabelText('Sign in').getAttribute('autocomplete')).toBe(
      'current-password'
    );
    const other = getByLabelText('Other');
    expect(other.getAttribute('autocomplete')).toBe('off');
    expect(other.classList.contains('ph-no-capture')).toBe(true);
    expect(other.getAttribute('spellcheck')).toBe('false');
  });

  it('is labelled by its <label>, submits on Enter and keeps focus while revealing', () => {
    const onSubmit = vi.fn();
    const [value, setValue] = createSignal('');
    const { getByLabelText, getByRole } = render(() => (
      <>
        <label for="secret">Password</label>
        <SecretInput
          id="secret"
          autocomplete="current-password"
          value={value()}
          onValueChange={setValue}
          onSubmit={onSubmit}
        />
      </>
    ));
    const input = getByLabelText('Password') as HTMLInputElement;
    input.focus();
    fireEvent.input(input, { target: { value: 'hunter2' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(onSubmit).toHaveBeenCalledOnce();

    const toggle = getByRole('button', { name: 'Show what you typed' });
    const pointerDown = new MouseEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
    });
    toggle.dispatchEvent(pointerDown);
    expect(pointerDown.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(input);
  });

  it('disables the field and the toggle, and shows an error state', () => {
    const { getByLabelText, getByRole } = render(() => (
      <SecretInput
        aria-label="Password"
        autocomplete="current-password"
        disabled
        aria-invalid
        value="typed"
        onValueChange={() => {}}
      />
    ));
    const input = getByLabelText('Password') as HTMLInputElement;

    expect(input.disabled).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(
      (
        getByRole('button', {
          name: 'Show what you typed',
        }) as HTMLButtonElement
      ).disabled
    ).toBe(true);
  });
});
