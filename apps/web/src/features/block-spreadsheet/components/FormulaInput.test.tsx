import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { FormulaInput } from './FormulaInput';

afterEach(cleanup);
it('accepts completion without committing, keeps caret/focus, and dismisses help before cancelling', async () => {
  const key = vi.fn();
  const blur = vi.fn();
  const view = render(() => {
    const [value, setValue] = createSignal('=SU');
    return (
      <FormulaInput
        label="Formula"
        value={value()}
        class=""
        onInput={setValue}
        onKeyDown={key}
        onBlur={blur}
        complete={async (text) =>
          text.endsWith('(')
            ? { expecting: [{ Argument: ['SUM', 1] }], replace_from: 4 }
            : { expecting: [{ FunctionName: 'SU' }], replace_from: 0 }
        }
      />
    );
  });
  const input = view.getByRole('textbox', {
    name: 'Formula',
  }) as HTMLTextAreaElement;
  input.focus();
  input.setSelectionRange(3, 3);
  fireEvent.select(input);
  await screen.findByRole('listbox', { name: 'Formula suggestions' });
  fireEvent.keyDown(input, { key: 'Tab' });
  await waitFor(() => expect(input.value).toBe('=SUM('));
  expect(input.selectionStart).toBe(5);
  expect(document.activeElement).toBe(input);
  expect(blur).not.toHaveBeenCalled();
  expect(key).not.toHaveBeenCalled();
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
  await waitFor(() =>
    expect(input.getAttribute('aria-describedby')).toBeTruthy()
  );
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(key).not.toHaveBeenCalled();
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(key).toHaveBeenCalledTimes(1);
});

it('does not request or display suggestions for a read-only formula', async () => {
  const complete = vi.fn();
  const view = render(() => (
    <FormulaInput
      label="Formula"
      value="=SU"
      class=""
      readonly
      complete={complete}
      onInput={() => {}}
      onKeyDown={() => {}}
      onBlur={() => {}}
    />
  ));
  view.getByRole('textbox').focus();
  await Promise.resolve();
  expect(complete).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).toBeNull();
});

it.each(['readonly', 'pickingReference'] as const)(
  'removes suggestion accessibility references when %s hides the popup',
  async (property) => {
    const [hidden, setHidden] = createSignal(false);
    const view = render(() => (
      <FormulaInput
        label="Formula"
        value="=SU"
        class=""
        readonly={property === 'readonly' && hidden()}
        pickingReference={property === 'pickingReference' && hidden()}
        complete={async () => ({
          expecting: [{ FunctionName: 'SU' }],
          replace_from: 0,
        })}
        onInput={() => {}}
        onKeyDown={() => {}}
        onBlur={() => {}}
      />
    ));
    const input = view.getByRole('textbox') as HTMLTextAreaElement;
    input.focus();
    input.setSelectionRange(3, 3);
    fireEvent.select(input);
    await screen.findByRole('listbox');
    expect(input.getAttribute('aria-controls')).toBeTruthy();
    expect(input.getAttribute('aria-activedescendant')).toBeTruthy();
    expect(input.getAttribute('aria-describedby')).toBeTruthy();
    setHidden(true);
    expect(screen.queryByRole('listbox')).toBeNull();
    expect(input.hasAttribute('aria-controls')).toBe(false);
    expect(input.hasAttribute('aria-activedescendant')).toBe(false);
    expect(input.hasAttribute('aria-describedby')).toBe(false);
  }
);

it('commits on blur after starting a formula without a mention adapter', () => {
  const blur = vi.fn();
  const view = render(() => {
    const [value, setValue] = createSignal('');
    return (
      <FormulaInput
        label="Formula"
        value={value()}
        class=""
        onInput={setValue}
        onKeyDown={() => {}}
        onBlur={blur}
      />
    );
  });
  const input = view.getByRole('textbox', { name: 'Formula' });
  input.focus();
  fireEvent.input(input, { target: { value: '=' } });
  input.blur();
  expect(blur).toHaveBeenCalledOnce();
});
