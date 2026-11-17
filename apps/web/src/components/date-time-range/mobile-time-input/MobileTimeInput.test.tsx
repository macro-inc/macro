import { cleanup, render, screen } from '@solidjs/testing-library';
import userEvent from '@testing-library/user-event';
import { createSignal } from 'solid-js';
import { afterEach, beforeAll, expect, it, vi } from 'vitest';
import { endTimeOptions, type TimeOption } from '../time-options';
import { MobileTimeInput } from './MobileTimeInput';

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function setup(options?: TimeOption[], initial = '09:00') {
  const change = vi.fn();
  const escaped = vi.fn();
  let disable: (value: boolean) => void = () => {};
  render(() => {
    const [value, setValue] = createSignal(initial);
    const [disabled, setDisabled] = createSignal(false);
    disable = setDisabled;
    return (
      <div
        onKeyDown={(event) => {
          if (event.key === 'Escape') escaped();
        }}
      >
        <MobileTimeInput
          id="time"
          label="Start time"
          value={value()}
          timeFormat="12-hour"
          options={options}
          date="2026-11-11"
          disabled={disabled()}
          onChange={(option) => {
            change(option);
            setValue(option.value);
          }}
        />
        <button type="button">Elsewhere</button>
      </div>
    );
  });
  return { change, escaped, disable };
}

it('opens a list without focusing an input, then types on the second tap', async () => {
  const { change } = setup();
  const trigger = screen.getByRole('combobox', { name: 'Start time' });
  expect(trigger.tagName).toBe('BUTTON');
  await userEvent.click(trigger);
  expect(screen.getByRole('listbox')).toBeTruthy();
  expect(document.activeElement?.tagName).not.toBe('INPUT');
  await userEvent.click(trigger);
  const field = screen.getByRole<HTMLInputElement>('combobox', {
    name: 'Start time',
  });
  expect(field.tagName).toBe('INPUT');
  expect(document.activeElement).toBe(field);
  await userEvent.keyboard('4p{Enter}');
  expect(change).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '16:00' })
  );
  expect(screen.getByRole('combobox', { name: 'Start time' }).tagName).toBe(
    'BUTTON'
  );
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('commits a picked value and returns focus to the value', async () => {
  const { change } = setup();
  const trigger = screen.getByRole('combobox', { name: 'Start time' });
  await userEvent.click(trigger);
  await userEvent.click(screen.getByRole('option', { name: '10:15am' }));
  expect(change).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '10:15' })
  );
  expect(document.activeElement).toBe(trigger);
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('commits an exact off-grid time on outside interaction', async () => {
  const { change } = setup();
  const trigger = screen.getByRole('combobox', { name: 'Start time' });
  await userEvent.click(trigger);
  await userEvent.click(trigger);
  await userEvent.keyboard('1307');
  await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(change).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '13:07' })
  );
  expect(document.activeElement).toBe(
    screen.getByRole('button', { name: 'Elsewhere' })
  );
});

it('restores the value on Escape without dismissing the parent', async () => {
  const { change, escaped } = setup();
  const trigger = screen.getByRole('combobox', { name: 'Start time' });
  await userEvent.click(trigger);
  await userEvent.click(trigger);
  await userEvent.keyboard('5p{Escape}');
  expect(change).not.toHaveBeenCalled();
  expect(escaped).not.toHaveBeenCalled();
  expect(
    screen.getByRole('combobox', { name: 'Start time' }).textContent
  ).toContain('9:00');
});

it('shows the next-day heading and preserves the end duration', async () => {
  const { change } = setup(endTimeOptions('20:00', '12-hour'), '21:00');
  await userEvent.click(screen.getByRole('combobox', { name: 'Start time' }));
  expect(screen.getByRole('group', { name: 'Thu, Nov 12' })).toBeTruthy();
  await userEvent.click(screen.getByRole('option', { name: /7:00am.*11h/ }));
  expect(change).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '07:00', dayOffset: 1, detail: '11h' })
  );
});

it('does not commit typed edits after permission loss', async () => {
  const { change, disable } = setup();
  const trigger = screen.getByRole('combobox', { name: 'Start time' });
  await userEvent.click(trigger);
  await userEvent.click(trigger);
  await userEvent.keyboard('5p');
  disable(true);
  await userEvent.click(screen.getByRole('button', { name: 'Elsewhere' }));
  expect(change).not.toHaveBeenCalled();
  expect(screen.queryByRole('listbox')).toBeNull();
  disable(false);
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('commits keyboard navigation from the resting value', async () => {
  const { change } = setup();
  const trigger = screen.getByRole('combobox', { name: 'Start time' });
  trigger.focus();
  await userEvent.keyboard('{ArrowDown}{ArrowDown}{Enter}');
  expect(change).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({ value: '09:15' })
  );
  expect(screen.queryByRole('listbox')).toBeNull();
});

it('discards a typed draft on disable without waiting for an outside press', async () => {
  const { change, disable } = setup();
  const trigger = screen.getByRole('combobox', { name: 'Start time' });
  await userEvent.click(trigger);
  await userEvent.click(trigger);
  await userEvent.keyboard('5p');
  disable(true);
  disable(false);
  expect(screen.queryByRole('listbox')).toBeNull();
  expect(
    screen.getByRole('combobox', { name: 'Start time' }).textContent
  ).toContain('9:00');
  expect(change).not.toHaveBeenCalled();
});
