import { cleanup, fireEvent, render } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createTouchPress } from './create-touch-press';

afterEach(cleanup);

function setup() {
  const press = vi.fn();
  const [disabled, setDisabled] = createSignal(false);
  const view = render(() => {
    const handlers = createTouchPress(press, disabled);
    return (
      <>
        <input aria-label="Editor" />
        <button {...handlers}>Apply</button>
      </>
    );
  });
  const button = view.getByRole('button');
  const editor = view.getByRole('textbox');
  vi.spyOn(button, 'getBoundingClientRect').mockReturnValue({
    x: 10,
    y: 10,
    left: 10,
    top: 10,
    right: 60,
    bottom: 54,
    width: 50,
    height: 44,
    toJSON: () => ({}),
  });
  editor.focus();
  return { ...view, press, button, editor, setDisabled };
}

function pointer(
  target: Element,
  type: string,
  options: {
    x?: number;
    y?: number;
    id?: number;
    primary?: boolean;
    pointerType?: string;
  } = {}
) {
  const event = new MouseEvent(type, {
    button: 0,
    bubbles: true,
    cancelable: true,
    clientX: options.x ?? 30,
    clientY: options.y ?? 30,
  });
  Object.defineProperties(event, {
    pointerId: { value: options.id ?? 1 },
    pointerType: { value: options.pointerType ?? 'touch' },
    isPrimary: { value: options.primary ?? true },
  });
  fireEvent(target, event);
  return event;
}

describe('focus-preserving touch press', () => {
  it('activates a valid touch release without requiring a click, and preserves focus', () => {
    const view = setup();
    expect(pointer(view.button, 'pointerdown').defaultPrevented).toBe(true);
    expect(pointer(view.button, 'pointerup').defaultPrevented).toBe(true);
    const compatibilityMouseDown = new MouseEvent('mousedown', {
      button: 0,
      bubbles: true,
      cancelable: true,
    });
    fireEvent(view.button, compatibilityMouseDown);
    expect(compatibilityMouseDown.defaultPrevented).toBe(true);
    expect(view.press).toHaveBeenCalledTimes(1);
    expect(document.activeElement).toBe(view.editor);
    fireEvent.click(view.button, { detail: 1 });
    expect(view.press).toHaveBeenCalledTimes(1);
  });

  it('supports repeated touch taps when no compatibility click is sent', () => {
    const view = setup();
    for (let tap = 0; tap < 2; tap++) {
      pointer(view.button, 'pointerdown');
      pointer(view.button, 'pointerup');
    }
    expect(view.press).toHaveBeenCalledTimes(2);
  });

  it('rejects a swipe without preventing native movement or reviving it on click', () => {
    const view = setup();
    pointer(view.button, 'pointerdown');
    expect(
      pointer(view.button, 'pointermove', { y: 42 }).defaultPrevented
    ).toBe(false);
    pointer(view.button, 'pointerup');
    fireEvent.click(view.button, { detail: 1 });
    expect(view.press).not.toHaveBeenCalled();
  });

  it('rejects cancellation, releases outside the button, and another finger anywhere', () => {
    const view = setup();
    pointer(view.button, 'pointerdown');
    pointer(view.button, 'pointercancel');
    pointer(view.button, 'pointerup');
    pointer(view.button, 'pointerdown', { x: 59 });
    pointer(view.button, 'pointerup', { x: 63 });
    pointer(view.button, 'pointerdown');
    pointer(view.editor, 'pointerdown', { id: 2, primary: false });
    pointer(view.button, 'pointerup');
    pointer(view.button, 'pointerdown', { primary: false });
    pointer(view.button, 'pointerup');
    expect(view.press).not.toHaveBeenCalled();
  });

  it('supports desktop clicks and keyboard activation after a touch with no click', () => {
    const view = setup();
    pointer(view.button, 'pointerdown');
    pointer(view.button, 'pointerup');
    fireEvent.click(view.button, { detail: 0 });
    expect(view.press).toHaveBeenCalledTimes(2);
    pointer(view.button, 'pointerdown', { pointerType: 'mouse' });
    pointer(view.button, 'pointerup', { pointerType: 'mouse' });
    expect(view.press).toHaveBeenCalledTimes(2);
    fireEvent.click(view.button, { detail: 1 });
    expect(view.press).toHaveBeenCalledTimes(3);
  });

  it('rechecks permissions at release and cancels on unmount', () => {
    const view = setup();
    pointer(view.button, 'pointerdown');
    view.setDisabled(true);
    pointer(view.button, 'pointerup');
    fireEvent.click(view.button, { detail: 0 });
    expect(view.press).not.toHaveBeenCalled();
    view.setDisabled(false);
    pointer(view.button, 'pointerdown');
    view.unmount();
    pointer(view.button, 'pointerup');
    expect(view.press).not.toHaveBeenCalled();
  });
});
