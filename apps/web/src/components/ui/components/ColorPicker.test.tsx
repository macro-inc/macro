import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ColorPicker, type ColorPickerRootProps } from './ColorPicker';

afterEach(cleanup);

function Fixture(props: ColorPickerRootProps) {
  const [value, setValue] = createSignal(props.value ?? '#ff0000');
  return (
    <ColorPicker.Root
      {...props}
      value={value()}
      onChange={(next) => {
        setValue(next);
        props.onChange?.(next);
      }}
    >
      <ColorPicker.Field />
      <ColorPicker.HueTrack />
      <ColorPicker.AlphaTrack />
      <ColorPicker.Input />
      <ColorPicker.Preview />
    </ColorPicker.Root>
  );
}

const input = () =>
  screen.getByRole('textbox', { name: 'Hex color' }) as HTMLInputElement;
const slider = (name: string) => {
  const matches = screen.getAllByRole('slider', { name });
  return (
    matches.find((element) => element.getAttribute('role') === 'slider') ??
    matches[0]
  );
};

describe('ColorPicker', () => {
  it('mounts malformed host values safely without emitting a change', () => {
    const onChange = vi.fn();
    render(() => (
      <Fixture value="oklch(0.5 undefined 20)" onChange={onChange} />
    ));
    expect(input().value).toBe('#000000');
    expect(onChange).not.toHaveBeenCalled();
    expect(slider('Saturation')).toBeTruthy();
    expect(slider('Brightness')).toBeTruthy();
  });

  it('commits valid hex on Enter, preserves alpha, and retains invalid drafts for correction', () => {
    const onChange = vi.fn();
    const onChangeEnd = vi.fn();
    render(() => <Fixture onChange={onChange} onChangeEnd={onChangeEnd} />);
    fireEvent.input(input(), { target: { value: '#0f08' } });
    expect(onChange).not.toHaveBeenCalled();
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(input().value).toBe('#00ff0088');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('#00ff0088');
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith('#00ff0088');
    fireEvent.input(input(), { target: { value: '#xx' } });
    expect(input().getAttribute('aria-invalid')).toBe('true');
    fireEvent.blur(input());
    expect(input().value).toBe('#xx');
    expect(onChange).toHaveBeenCalledTimes(1);
    fireEvent.input(input(), { target: { value: '#ffffff' } });
    fireEvent.keyDown(input(), { key: 'Escape' });
    expect(input().value).toBe('#00ff0088');
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('preserves hue through black and white with controlled hex echoes', () => {
    render(() => <Fixture value="#0000ff" />);
    const brightness = slider('Brightness');
    fireEvent.keyDown(brightness, { key: 'Home' });
    fireEvent.keyUp(brightness, { key: 'Home' });
    expect(input().value).toBe('#000000');
    expect(slider('Hue').getAttribute('aria-valuenow')).toBe('240');
    fireEvent.keyDown(slider('Hue'), { key: 'ArrowLeft', shiftKey: true });
    fireEvent.keyUp(slider('Hue'), { key: 'ArrowLeft' });
    expect(slider('Hue').getAttribute('aria-valuenow')).toBe('204');
    fireEvent.keyDown(brightness, { key: 'End' });
    fireEvent.keyDown(slider('Saturation'), { key: 'Home' });
    expect(input().value).toBe('#ffffff');
    expect(slider('Hue').getAttribute('aria-valuenow')).toBe('204');
    fireEvent.keyDown(slider('Saturation'), { key: 'End' });
    expect(input().value).toBe('#0099ff');
  });

  it('keeps opacity while changing hue and ends a keyboard gesture once', () => {
    const onChangeEnd = vi.fn();
    render(() => <Fixture value="#ff000080" onChangeEnd={onChangeEnd} />);
    fireEvent.keyDown(slider('Hue'), { key: 'ArrowRight' });
    fireEvent.keyDown(slider('Hue'), { key: 'ArrowRight' });
    expect(input().value).toBe('#ff090080');
    expect(onChangeEnd).not.toHaveBeenCalled();
    fireEvent.keyUp(slider('Hue'), { key: 'ArrowRight' });
    expect(onChangeEnd).toHaveBeenCalledTimes(1);
    slider('Opacity').focus();
    fireEvent.keyDown(slider('Opacity'), { key: 'End' });
    fireEvent.keyUp(slider('Opacity'), { key: 'End' });
    expect(input().value).toBe('#ff0900');
  });

  it.each(['disabled', 'readOnly'] as const)(
    'does not change a %s picker',
    (lock) => {
      const onChange = vi.fn();
      render(() => <Fixture {...{ [lock]: true }} onChange={onChange} />);
      fireEvent.keyDown(slider('Saturation'), { key: 'Home' });
      fireEvent.keyDown(slider('Hue'), { key: 'End' });
      fireEvent.input(input(), { target: { value: '#fff' } });
      fireEvent.keyDown(input(), { key: 'Enter' });
      expect(onChange).not.toHaveBeenCalled();
    }
  );

  it('accepts independent host updates and keeps two picker contexts separate', () => {
    const [value, setValue] = createSignal('#ff0000');
    render(() => (
      <>
        <ColorPicker.Root value={value()}>
          <ColorPicker.Input aria-label="First" />
        </ColorPicker.Root>
        <ColorPicker.Root defaultValue="#0000ff">
          <ColorPicker.Input aria-label="Second" />
        </ColorPicker.Root>
      </>
    ));
    setValue('rgba(0, 255, 0, .5)');
    expect(
      (screen.getByRole('textbox', { name: 'First' }) as HTMLInputElement).value
    ).toBe('#00ff0080');
    expect(
      (screen.getByRole('textbox', { name: 'Second' }) as HTMLInputElement)
        .value
    ).toBe('#0000ff');
  });

  it('cancels a touch field drag without leaving the draft color behind', () => {
    const onChangeEnd = vi.fn();
    const { container } = render(() => <Fixture onChangeEnd={onChangeEnd} />);
    const field = container.querySelector(
      '[data-color-picker-field]'
    ) as HTMLDivElement;
    let captured = false;
    field.setPointerCapture = () => {
      captured = true;
    };
    field.hasPointerCapture = () => captured;
    field.releasePointerCapture = () => {
      captured = false;
    };
    field.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 100,
      width: 100,
      height: 100,
      toJSON() {},
    });
    const dispatch = (type: string, x: number, y: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, {
        button: 0,
        pointerId: 1,
        pointerType: 'touch',
        clientX: x,
        clientY: y,
      });
      field.dispatchEvent(event);
    };
    dispatch('pointerdown', 50, 50);
    expect(input().value).toBe('#804040');
    dispatch('pointermove', 100, 75);
    expect(input().value).toBe('#400000');
    expect(onChangeEnd).not.toHaveBeenCalled();
    dispatch('pointercancel', 100, 75);
    expect(input().value).toBe('#ff0000');
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith('#ff0000');
    expect(captured).toBe(false);
  });

  it('releases a canceled hue drag and ignores subsequent pointer motion', () => {
    const onChangeEnd = vi.fn();
    render(() => <Fixture onChangeEnd={onChangeEnd} />);
    const thumb = slider('Hue');
    const track = thumb.parentElement!;
    let captured = false;
    track.setPointerCapture = () => {
      captured = true;
    };
    track.hasPointerCapture = () => captured;
    track.releasePointerCapture = () => {
      captured = false;
    };
    track.getBoundingClientRect = () => ({
      x: 0,
      y: 0,
      left: 0,
      top: 0,
      right: 100,
      bottom: 10,
      width: 100,
      height: 10,
      toJSON() {},
    });
    const dispatch = (type: string, x: number) => {
      const event = new Event(type, { bubbles: true, cancelable: true });
      Object.assign(event, { button: 0, pointerId: 1, clientX: x, clientY: 5 });
      track.dispatchEvent(event);
    };
    dispatch('pointerdown', 50);
    expect(input().value).toBe('#00ffff');
    dispatch('pointermove', 75);
    expect(input().value).toBe('#8000ff');
    fireEvent.keyDown(thumb, { key: 'Escape' });
    expect(input().value).toBe('#ff0000');
    expect(captured).toBe(false);
    expect(onChangeEnd).toHaveBeenCalledExactlyOnceWith('#ff0000');
    dispatch('pointermove', 90);
    expect(input().value).toBe('#ff0000');
  });
});
