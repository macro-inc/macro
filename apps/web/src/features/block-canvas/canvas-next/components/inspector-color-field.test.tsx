import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { InspectorColorField } from './inspector-color-field';

vi.mock('@app/features/theme/components/ColorPickerPopover', () => {
  throw new Error('Canvas must not load the theme color picker');
});
vi.mock('../primitives/read-swatch-color', () => ({
  readSwatchColor: () => '#808080',
}));

afterEach(cleanup);

function Fixture(props: { value?: string; onChange: (color: string) => void }) {
  const [color, setColor] = createSignal(props.value);
  return (
    <InspectorColorField
      label="Fill"
      value={color()}
      canvasColors={['#123456', 'var(--color-ink)']}
      onChange={(next) => {
        setColor(next);
        props.onChange(next);
      }}
    />
  );
}

it.each([
  undefined,
  'transparent',
  '#000000',
  '#ffffff',
  '#808080',
  'var(--color-ink)',
])('mounts %s without converting or emitting a color', (value) => {
  const onChange = vi.fn();
  render(() => <Fixture value={value} onChange={onChange} />);
  expect(
    screen.getByRole('button', { name: 'Fill color picker' })
  ).toBeTruthy();
  expect(onChange).not.toHaveBeenCalled();
});

it('accepts short hex and alpha while rejecting incomplete input', () => {
  const onChange = vi.fn();
  render(() => <Fixture value="#123456" onChange={onChange} />);
  const input = screen.getByRole('textbox', {
    name: 'Fill color',
  }) as HTMLInputElement;
  fireEvent.change(input, { target: { value: 'abc8' } });
  expect(onChange).toHaveBeenLastCalledWith('#abc8');
  fireEvent.change(input, { target: { value: '#12' } });
  expect(screen.getByRole('alert').textContent).toContain('hex');
  expect(onChange).toHaveBeenCalledTimes(1);
  fireEvent.keyDown(input, { key: 'Escape' });
  expect(input.value).toBe('ABC8');
});

it('opens a neutral swatch and preserves palette references when selecting a preset', async () => {
  const onChange = vi.fn();
  render(() => <Fixture value="var(--color-ink)" onChange={onChange} />);
  fireEvent.click(screen.getByRole('button', { name: 'Fill color picker' }));
  await waitFor(() =>
    expect(
      screen.getByRole('dialog', { name: 'Fill color picker' })
    ).toBeTruthy()
  );
  expect(onChange).not.toHaveBeenCalled();
  expect(screen.getAllByRole('slider', { name: 'Hue' })).not.toHaveLength(0);
  expect(screen.getAllByRole('slider', { name: 'Opacity' })).not.toHaveLength(
    0
  );
  fireEvent.click(screen.getByRole('button', { name: 'Fill: Surface' }));
  expect(onChange).toHaveBeenLastCalledWith('var(--color-panel)');
  fireEvent.click(screen.getByRole('button', { name: 'Fill: None' }));
  expect(onChange).toHaveBeenLastCalledWith('transparent');
});
