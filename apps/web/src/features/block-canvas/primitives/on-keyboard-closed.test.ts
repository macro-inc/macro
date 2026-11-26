import { setVirtualKeyboardVisible } from '@core/mobile/virtualKeyboard';
import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { onKeyboardClosed } from './on-keyboard-closed';

const cleanups: (() => void)[] = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  setVirtualKeyboardVisible(false);
  vi.unstubAllGlobals();
});

/** A visual viewport 600 x 1000 whose size the test sets. */
function setup() {
  const visual = Object.assign(new EventTarget(), {
    width: 600,
    height: 1000,
    scale: 1,
  });
  vi.stubGlobal('visualViewport', visual);
  const closed = vi.fn();
  createRoot((dispose) => {
    cleanups.push(dispose);
    onKeyboardClosed(closed);
  });
  const resize = (height: number, width = visual.width) => {
    visual.height = height;
    visual.width = width;
    visual.dispatchEvent(new Event('resize'));
  };
  return { closed, resize, visual };
}

it('reports the keyboard the app tracks going away', () => {
  const { closed } = setup();

  setVirtualKeyboardVisible(true);
  expect(closed).not.toHaveBeenCalled();
  setVirtualKeyboardVisible(false);

  expect(closed).toHaveBeenCalledOnce();
});

it('reports a keyboard that only showed as a shorter visual viewport', () => {
  const { closed, resize } = setup();

  resize(660);
  // Switching to the emoji keyboard changes its height, not whether it is up.
  resize(620);
  expect(closed).not.toHaveBeenCalled();
  resize(1000);

  expect(closed).toHaveBeenCalledOnce();
});

it('says nothing about a viewport that never had a keyboard on it', () => {
  const { closed, resize, visual } = setup();

  // The browser's own bars come and go.
  resize(950);
  resize(1000);
  // A pinch-zoomed page has a short visual viewport too.
  visual.scale = 2;
  resize(500);
  visual.scale = 1;
  resize(1000);
  // Turned on its side and back: shorter, but not for a keyboard.
  resize(600, 1000);
  resize(1000, 600);

  expect(closed).not.toHaveBeenCalled();
});
