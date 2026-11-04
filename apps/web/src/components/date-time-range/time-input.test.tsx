import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { TimeInput } from './time-input';
import { endTimeOptions, type TimeOption } from './time-options';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(cleanup);

function renderTime(initial: string, options?: TimeOption[]) {
  const onChange = vi.fn<(option: TimeOption) => void>();
  render(() => {
    const [value, setValue] = createSignal(initial);
    return (
      <>
        <TimeInput
          id="start-time"
          label="Start time"
          value={value()}
          options={options}
          onChange={(option) => {
            onChange(option);
            setValue(option.value);
          }}
        />
        <button type="button">Elsewhere</button>
      </>
    );
  });
  const field = screen.getByRole<HTMLInputElement>('combobox', {
    name: 'Start time',
  });
  return { field, onChange };
}

describe('TimeInput', () => {
  it('fills in the time being typed and commits it on Enter', async () => {
    const { field, onChange } = renderTime('09:00');
    expect(field.value).toBe('9:00 AM');

    await userEvent.click(field);
    expect(field.getAttribute('aria-expanded')).toBe('true');
    await userEvent.keyboard('4');
    expect(field.value).toBe('4:00 AM');
    expect(field.value.slice(field.selectionStart ?? 0)).toBe(':00 AM');
    expect(screen.getByRole('option', { name: '4:00 AM' }).id).toBe(
      field.getAttribute('aria-activedescendant')
    );

    // Typing over the filled-in part keeps reading what was typed.
    await userEvent.keyboard('p{Enter}');
    expect(onChange).toHaveBeenLastCalledWith(
      expect.objectContaining({ value: '16:00' })
    );
    expect(field.value).toBe('4:00 PM');
    expect(field.getAttribute('aria-expanded')).toBe('false');
  });

  it('commits a time no option lists, exactly as typed', async () => {
    const { field, onChange } = renderTime('09:00');
    await userEvent.click(field);
    await userEvent.keyboard('1307');
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ value: '13:07' })
    );
    expect(field.value).toBe('1:07 PM');
  });

  it('puts the old time back on Escape or when the entry is no time', async () => {
    const { field, onChange } = renderTime('09:00');
    await userEvent.click(field);
    await userEvent.keyboard('5p{Escape}');
    expect(field.value).toBe('9:00 AM');

    await userEvent.keyboard('soon');
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(field.value).toBe('9:00 AM');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('moves through the list with the arrow keys', async () => {
    const { field, onChange } = renderTime('09:00');
    await userEvent.click(field);
    await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ value: '09:30' })
    );
  });

  it('leaves the time alone when the pointer only passed over the list', async () => {
    const { field, onChange } = renderTime('09:00');
    await userEvent.click(field);
    await userEvent.hover(screen.getByRole('option', { name: '11:00 AM' }));
    await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(field.value).toBe('9:00 AM');
  });

  it('takes an end soonest after its start, with the length it makes', async () => {
    const { field, onChange } = renderTime('21:00', endTimeOptions('20:00'));
    await userEvent.click(field);
    expect(
      screen
        .getByRole('option', { name: /^9:00 PM/ })
        .getAttribute('aria-selected')
    ).toBe('true');
    await userEvent.keyboard('7{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith(
      expect.objectContaining({ value: '07:00', dayOffset: 1, detail: '11h' })
    );
  });
});
