import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createComposerHeaderDrag } from './create-composer-header-drag';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  document.body.replaceChildren();
});

function pointer(
  target: EventTarget,
  type: string,
  x: number,
  y: number,
  pointerId = 1
) {
  const event = new MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientX: x,
    clientY: y,
  });
  Object.defineProperties(event, {
    pointerId: { value: pointerId },
    isPrimary: { value: true },
  });
  target.dispatchEvent(event);
}

function setup() {
  const header = document.createElement('div');
  const button = document.createElement('button');
  header.append(button);
  document.body.append(header);
  let captured = false;
  header.setPointerCapture = vi.fn(() => {
    captured = true;
  });
  header.hasPointerCapture = vi.fn(() => captured);
  header.releasePointerCapture = vi.fn(() => {
    captured = false;
  });
  const onPin = vi.fn();
  const onFinish = vi.fn();
  let disabled = false;
  let width = 1000;
  const source = createRoot((dispose) => {
    disposers.push(dispose);
    return createComposerHeaderDrag({
      boundary: () => ({ left: 300, top: 100, width, height: 800 }),
      surface: () => ({ left: 500, top: 200, width: 384, height: 500 }),
      disabled: () => disabled,
      onPin,
      onFinish,
    });
  });
  header.addEventListener('pointerdown', source.start);
  return {
    header,
    button,
    source,
    onPin,
    onFinish,
    resize: (nextWidth: number) => {
      width = nextWidth;
    },
    disable: () => {
      disabled = true;
    },
  };
}

it('keeps clicks below threshold still and ignores header controls', () => {
  const { header, button, source, onPin } = setup();
  pointer(button, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 1100, 210);
  expect(source.state.active).toBe(false);
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 604, 211);
  pointer(window, 'pointerup', 604, 211);
  expect(source.state.position).toBeUndefined();
  expect(onPin).not.toHaveBeenCalled();
});

it('does not steal pointer input from a header menu item', () => {
  const { header, source } = setup();
  const item = document.createElement('div');
  item.setAttribute('role', 'menuitemradio');
  header.append(item);
  pointer(item, 'pointerdown', 620, 250);
  pointer(window, 'pointermove', 1100, 250);
  expect(source.state.active).toBe(false);
});

it('moves the same surface and pins only after release in the future dock', () => {
  const { header, source, onPin, onFinish } = setup();
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 800, 250);
  expect(source.state.position).toEqual({ x: 700, y: 240 });
  expect(source.state.overTarget).toBe(false);
  pointer(window, 'pointermove', 1100, 250);
  expect(source.state.position).toEqual({ x: 908, y: 240 });
  expect(source.state.overTarget).toBe(true);
  expect(onPin).not.toHaveBeenCalled();
  pointer(window, 'pointerup', 1100, 250);
  expect(onPin).toHaveBeenCalledOnce();
  expect(onFinish).toHaveBeenCalledExactlyOnceWith('pinned');
  expect(header.releasePointerCapture).toHaveBeenCalledExactlyOnceWith(1);
});

it('keeps an unpinned drop position and restores it when a later drag is cancelled', () => {
  const { header, source, onPin, onFinish } = setup();
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointerup', 700, 250);
  expect(source.state.position).toEqual({ x: 600, y: 240 });
  expect(onFinish).toHaveBeenLastCalledWith('floating');
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 1100, 250);
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    cancelable: true,
  });
  window.dispatchEvent(escapeEvent);
  expect(escapeEvent.defaultPrevented).toBe(true);
  expect(source.state.position).toEqual({ x: 600, y: 240 });
  expect(source.state.active).toBe(false);
  pointer(window, 'pointerup', 1100, 250);
  expect(onPin).not.toHaveBeenCalled();
  expect(onFinish).toHaveBeenLastCalledWith('cancelled');
});

it('cancels on capture loss, blur, permission loss, and owner disposal', () => {
  for (const reason of ['lostpointercapture', 'blur', 'disabled', 'dispose']) {
    const { header, source, onPin, onFinish, disable } = setup();
    pointer(header, 'pointerdown', 600, 210);
    pointer(window, 'pointermove', 1100, 250);
    if (reason === 'lostpointercapture') pointer(header, reason, 1100, 250);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'disabled') {
      disable();
      pointer(window, 'pointerup', 1100, 250);
    }
    if (reason === 'dispose') disposers.pop()?.();
    expect(source.state.active).toBe(false);
    expect(source.state.position).toBeUndefined();
    expect(onPin).not.toHaveBeenCalled();
    expect(onFinish).toHaveBeenLastCalledWith('cancelled');
  }
});

it('ignores other pointers and never pins outside the boundary height', () => {
  const { header, source, onPin } = setup();
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 1100, 250, 2);
  pointer(window, 'pointercancel', 1100, 250, 2);
  expect(source.state.active).toBe(false);
  pointer(window, 'pointermove', 1100, 950);
  expect(source.state.overTarget).toBe(false);
  pointer(window, 'pointerup', 1100, 950);
  expect(onPin).not.toHaveBeenCalled();
});

it('keeps a moved surface inside resized content without mutating its saved position', () => {
  const { header, source, resize } = setup();
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointerup', 850, 250);
  expect(source.position()).toEqual({ x: 750, y: 240 });
  resize(500);
  expect(source.position()).toEqual({ x: 408, y: 240 });
  resize(1000);
  expect(source.position()).toEqual({ x: 750, y: 240 });
});
