import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ToggleSwitch } from './ToggleSwitch';

afterEach(cleanup);

it('updates a controlled switch once per click', () => {
  const onChange = vi.fn();
  render(() => {
    const [checked, setChecked] = createSignal(false);
    return (
      <ToggleSwitch
        label="Enabled"
        checked={checked()}
        onChange={(next) => {
          setChecked(next);
          onChange(next);
        }}
      />
    );
  });
  const input = screen.getByRole('switch') as HTMLInputElement;
  fireEvent.click(input);
  expect(input.checked).toBe(true);
  expect(onChange).toHaveBeenCalledExactlyOnceWith(true);
  fireEvent.click(input);
  expect(input.checked).toBe(false);
  expect(onChange).toHaveBeenLastCalledWith(false);
});

it('keeps a disabled switch unchanged when its label is clicked', () => {
  const onChange = vi.fn();
  render(() => (
    <ToggleSwitch
      label="Disabled setting"
      disabled
      defaultChecked
      onChange={onChange}
    />
  ));
  fireEvent.click(screen.getByText('Disabled setting'));
  expect((screen.getByRole('switch') as HTMLInputElement).checked).toBe(true);
  expect(onChange).not.toHaveBeenCalled();
});
