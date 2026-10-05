import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it } from 'vitest';
import { CalendarColorPicker } from './calendar-color-picker';

afterEach(cleanup);

it('previews swatches, validates hex input, and preserves the selected hue through black', async () => {
  let saved: string | undefined;
  render(() => {
    const [color, setColor] = createSignal('#0000ff');
    return (
      <CalendarColorPicker
        label="Work color"
        color={color()}
        overridden={true}
        onChange={(value) => {
          saved = value;
          setColor(value ?? '#0000ff');
        }}
      />
    );
  });
  fireEvent.click(screen.getByRole('button', { name: 'Work color' }));
  const input = await screen.findByRole('textbox', { name: 'Hex color' });
  fireEvent.click(screen.getByRole('button', { name: 'Sage' }));
  expect(saved).toBe('#8bbf96');
  fireEvent.input(input, { target: { value: 'nope' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(input.getAttribute('aria-invalid')).toBe('true');
  expect(saved).toBe('#8bbf96');

  fireEvent.input(input, { target: { value: '#00f' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  expect(saved).toBe('#0000ff');
  fireEvent.input(input, { target: { value: '#000' } });
  fireEvent.keyDown(input, { key: 'Enter' });
  const field = screen.getByRole('slider', {
    name: 'Saturation and brightness',
  });
  for (let i = 0; i < 10; i++) {
    fireEvent.keyDown(field, { key: 'ArrowUp', shiftKey: true });
    fireEvent.keyDown(field, { key: 'ArrowRight', shiftKey: true });
  }
  expect(saved).toBe('#0000ff');
  expect(input.getAttribute('aria-invalid')).toBe('false');
  const hue = screen.getByRole('slider', { name: 'Hue' });
  fireEvent.focus(hue);
  fireEvent.keyDown(hue, { key: 'Home' });
  expect(saved).toBe('#ff0000');
});
