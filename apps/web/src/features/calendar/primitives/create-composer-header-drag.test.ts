import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createComponent, createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { ComposerPin } from '../components/composer/actions/ComposerPin';
import { createComposerHeaderDrag } from './create-composer-header-drag';

const disposers: (() => void)[] = [];
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  cleanup();
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
  const onPin = vi.fn(() => {
    pinned = true;
  });
  const onUnpin = vi.fn(() => {
    pinned = false;
  });
  const onFinish = vi.fn();
  let disabled = false;
  let canPin = true;
  let pinned = false;
  let width = 1000;
  let height = 500;
  let target:
    | { left: number; top: number; width: number; height: number }
    | undefined;
  const source = createRoot((dispose) => {
    disposers.push(dispose);
    return createComposerHeaderDrag({
      boundary: () => ({ left: 300, top: 100, width, height: 800 }),
      surface: () => new DOMRect(500, 200, 384, height),
      pinTarget: () => target,
      canPin: () => canPin,
      disabled: () => disabled,
      pinned: () => pinned,
      onPin,
      onUnpin,
      onFinish,
    });
  });
  header.addEventListener('pointerdown', source.start);
  return {
    header,
    button,
    source,
    onPin,
    onUnpin,
    onFinish,
    allowPin: (value: boolean) => {
      canPin = value;
    },
    setPinned: (value: boolean) => {
      pinned = value;
    },
    setHeight: (value: number) => {
      height = value;
    },
    setTarget: (value: typeof target) => {
      target = value;
    },
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

it('keeps a drag floating when responsive layout suppresses pin targets', () => {
  const { header, source, onPin, onFinish, allowPin } = setup();
  allowPin(false);
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 400, 250);
  expect(source.target()).toBeUndefined();
  expect(source.state.overTarget).toBe(false);
  pointer(window, 'pointerup', 400, 250);
  expect(onPin).not.toHaveBeenCalled();
  expect(onFinish).toHaveBeenCalledWith('floating');
});
it('moves the same surface and pins only after release in the future dock', () => {
  const { header, source, onPin, onFinish } = setup();
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 800, 250);
  expect(source.state.position).toEqual({ x: 700, y: 240 });
  expect(source.state.overTarget).toBe(false);
  pointer(window, 'pointermove', 400, 250);
  expect(source.state.position).toEqual({ x: 308, y: 240 });
  expect(source.state.overTarget).toBe(true);
  expect(onPin).not.toHaveBeenCalled();
  pointer(window, 'pointerup', 400, 250);
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
  pointer(window, 'pointermove', 400, 250);
  const escapeEvent = new KeyboardEvent('keydown', {
    key: 'Escape',
    cancelable: true,
  });
  window.dispatchEvent(escapeEvent);
  expect(escapeEvent.defaultPrevented).toBe(true);
  expect(source.state.position).toEqual({ x: 600, y: 240 });
  expect(source.state.active).toBe(false);
  pointer(window, 'pointerup', 400, 250);
  expect(onPin).not.toHaveBeenCalled();
  expect(onFinish).toHaveBeenLastCalledWith('cancelled');
});

it('cancels on capture loss, blur, permission loss, and owner disposal', () => {
  for (const reason of ['lostpointercapture', 'blur', 'disabled', 'dispose']) {
    const { header, source, onPin, onFinish, disable } = setup();
    pointer(header, 'pointerdown', 600, 210);
    pointer(window, 'pointermove', 400, 250);
    if (reason === 'lostpointercapture') pointer(header, reason, 400, 250);
    if (reason === 'blur') window.dispatchEvent(new Event('blur'));
    if (reason === 'disabled') {
      disable();
      pointer(window, 'pointerup', 400, 250);
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

it('uses the visible sidebar footprint rather than the expanded dock width', () => {
  const { header, source, setTarget, onPin } = setup();
  setTarget({ left: 300, top: 100, width: 250, height: 800 });
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointermove', 600, 250);
  expect(source.state.overTarget).toBe(false);
  pointer(window, 'pointerup', 540, 250);
  expect(onPin).toHaveBeenCalledOnce();
});
it('lifts a full-height pinned card along both pointer axes', () => {
  const { header, source, setPinned, setHeight } = setup();
  setPinned(true);
  setHeight(800);
  pointer(header, 'pointerdown', 500, 210);
  pointer(window, 'pointermove', 900, 330);
  expect(source.position()).toEqual({ x: 900, y: 320 });
  pointer(window, 'pointerup', 900, 330);
  expect(source.state.position).toBeDefined();
});
it('drags a pinned composer over the grid and keeps its drop position', () => {
  const { header, source, onPin, onUnpin, onFinish, setPinned } = setup();
  setPinned(true);
  pointer(header, 'pointerdown', 500, 210);
  pointer(window, 'pointermove', 900, 250);
  expect(source.state.active).toBe(true);
  expect(source.state.overTarget).toBe(false);
  expect(source.state.position).toEqual({ x: 900, y: 240 });
  expect(onUnpin).not.toHaveBeenCalled();
  pointer(window, 'pointerup', 900, 250);
  expect(onUnpin).toHaveBeenCalledOnce();
  expect(onPin).not.toHaveBeenCalled();
  expect(source.state.position).toEqual({ x: 900, y: 240 });
  expect(onFinish).toHaveBeenLastCalledWith('floating');
});

it('retains pinning when a pinned drag returns to the dock', () => {
  const { header, source, onPin, onUnpin, onFinish, setPinned } = setup();
  setPinned(true);
  pointer(header, 'pointerdown', 500, 210);
  pointer(window, 'pointermove', 900, 250);
  pointer(window, 'pointermove', 400, 250);
  expect(source.state.overTarget).toBe(true);
  pointer(window, 'pointerup', 400, 250);
  expect(onPin).not.toHaveBeenCalled();
  expect(onUnpin).not.toHaveBeenCalled();
  expect(source.state.position).toBeUndefined();
  expect(onFinish).toHaveBeenLastCalledWith('pinned');
});

it('resets a floating position after pinning and unpins the same session on a later drag', () => {
  const { header, source, onPin, onUnpin, setPinned } = setup();
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointerup', 700, 250);
  expect(source.state.position).toEqual({ x: 600, y: 240 });
  pointer(header, 'pointerdown', 600, 210);
  pointer(window, 'pointerup', 400, 250);
  expect(onPin).toHaveBeenCalledOnce();
  expect(source.state.position).toBeUndefined();
  setPinned(true);
  pointer(header, 'pointerdown', 500, 210);
  pointer(window, 'pointerup', 900, 250);
  expect(onUnpin).toHaveBeenCalledOnce();
  expect(source.state.position).toEqual({ x: 900, y: 240 });
});

it('cancels a pinned drag without changing pinning or its anchor', () => {
  const { header, source, onPin, onUnpin, onFinish, setPinned } = setup();
  setPinned(true);
  pointer(header, 'pointerdown', 500, 210);
  pointer(window, 'pointermove', 900, 250);
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
  expect(source.state.active).toBe(false);
  expect(source.state.position).toBeUndefined();
  expect(onPin).not.toHaveBeenCalled();
  expect(onUnpin).not.toHaveBeenCalled();
  expect(onFinish).toHaveBeenLastCalledWith('cancelled');
  pointer(window, 'pointerup', 900, 250);
  expect(onUnpin).not.toHaveBeenCalled();
});

it('keeps the pin button actionable in both states', () => {
  const onToggle = vi.fn();
  const floating = render(() =>
    createComponent(ComposerPin, { pinned: false, onToggle })
  );
  const pin = screen.getByRole('button', { name: /pin/i });
  expect(pin.getAttribute('aria-pressed')).toBe('false');
  fireEvent.click(pin);
  floating.unmount();
  render(() => createComponent(ComposerPin, { pinned: true, onToggle }));
  const unpin = screen.getByRole('button', { name: /unpin/i });
  expect(unpin.getAttribute('aria-pressed')).toBe('true');
  fireEvent.click(unpin);
  expect(onToggle).toHaveBeenCalledTimes(2);
});
