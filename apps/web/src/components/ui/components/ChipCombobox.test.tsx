import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { ChipCombobox, type ChipComboboxOption } from './ChipCombobox';

const OPTIONS: ChipComboboxOption[] = [
  { value: 'globex.example', label: 'Globex', detail: 'globex.example' },
  { value: 'acme.com', label: 'acme.com', detail: '12 contacts' },
];

const parseDomain = (text: string) =>
  /^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(text.trim())
    ? text.trim().toLowerCase()
    : undefined;

afterEach(cleanup);

function renderField(initial: string[] = []) {
  const [values, setValues] = createSignal(initial);
  render(() => (
    <form onSubmit={() => setValues((current) => [...current, 'submitted'])}>
      <ChipCombobox
        values={values()}
        onChange={setValues}
        options={OPTIONS}
        parseValue={parseDomain}
        addLabel={(value) => `Add ${value}`}
        removeLabel={(value) => `Remove ${value}`}
        aria-label="Domains"
      />
    </form>
  ));
  return { input: screen.getByRole<HTMLInputElement>('combobox'), values };
}

describe('ChipCombobox', () => {
  it('adds a suggestion picked from the list', async () => {
    const user = userEvent.setup();
    const { input, values } = renderField();
    await user.click(input);
    await user.type(input, 'glo');
    await user.click(await screen.findByRole('option', { name: /Globex/ }));
    expect(values()).toEqual(['globex.example']);
    expect(screen.getByText('globex.example')).toBeTruthy();
  });

  it('adds typed values ended by a separator and keeps the rest typed', () => {
    const { input, values } = renderField();
    fireEvent.input(input, { target: { value: 'Newco.io, other.dev; nope,' } });
    expect(values()).toEqual(['newco.io', 'other.dev']);
    expect(input.value).toBe('');
  });

  it('adds what was typed on Enter without submitting the form', async () => {
    const user = userEvent.setup();
    const { input, values } = renderField();
    await user.click(input);
    await user.type(input, 'globex.ex{Enter}');
    expect(values()).toEqual(['globex.ex']);
  });

  it('takes the top suggestion on Enter when the text is not a value', async () => {
    const user = userEvent.setup();
    const { input, values } = renderField();
    await user.click(input);
    await user.type(input, 'acm{Enter}');
    expect(values()).toEqual(['acme.com']);
  });

  it('offers to add a typed value no suggestion matches', async () => {
    const user = userEvent.setup();
    const { input, values } = renderField();
    await user.click(input);
    await user.type(input, 'initech.example');
    await user.click(
      await screen.findByRole('option', { name: 'Add initech.example' })
    );
    expect(values()).toEqual(['initech.example']);
  });

  it('keeps a typed value when focus leaves the field', async () => {
    const user = userEvent.setup();
    const { input, values } = renderField();
    await user.click(input);
    await user.type(input, 'umbrella.example');
    await user.tab();
    expect(values()).toEqual(['umbrella.example']);
  });

  it('removes chips with their button and with Backspace', async () => {
    const user = userEvent.setup();
    const { input, values } = renderField(['acme.com', 'globex.example']);
    await user.click(screen.getByRole('button', { name: 'Remove acme.com' }));
    expect(values()).toEqual(['globex.example']);
    await user.click(input);
    await user.keyboard('{Backspace}');
    expect(values()).toEqual([]);
  });

  it('leaves chosen values out of the suggestions', async () => {
    const user = userEvent.setup();
    const { input } = renderField(['acme.com']);
    await user.click(input);
    expect(await screen.findByRole('option', { name: /Globex/ })).toBeTruthy();
    expect(screen.queryByRole('option', { name: /acme\.com/ })).toBeNull();
  });
});
