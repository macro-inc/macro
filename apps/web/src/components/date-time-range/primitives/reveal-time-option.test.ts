import { afterEach, expect, it, vi } from 'vitest';
import {
  observeTimeOptionViewport,
  revealTimeOption,
} from './reveal-time-option';

afterEach(() => {
  document.body.replaceChildren();
  vi.unstubAllGlobals();
});

it('centers within an animated menu without scrolling any ancestor', () => {
  const viewport = document.createElement('div');
  const list = document.createElement('div');
  const option = document.createElement('div');
  option.dataset.highlighted = '';
  list.append(option);
  viewport.append(list);
  document.body.append(viewport);
  Object.defineProperties(viewport, {
    clientHeight: { value: 256 },
    offsetHeight: { value: 256 },
  });
  Object.defineProperty(option, 'offsetHeight', { value: 32 });
  viewport.getBoundingClientRect = () => new DOMRect(0, 100, 150, 128);
  option.getBoundingClientRect = () => new DOMRect(0, 180, 150, 16);
  revealTimeOption(list, true);
  expect(viewport.scrollTop).toBe(48);
  expect(document.documentElement.scrollTop).toBe(0);
});

it('reserves enough scroll padding to center the first and last options', () => {
  let resized = () => {};
  const disconnect = vi.fn();
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect = disconnect;
    }
  );
  const viewport = document.createElement('div');
  const list = document.createElement('div');
  const option = document.createElement('div');
  option.setAttribute('role', 'option');
  list.append(option);
  viewport.append(list);
  document.body.append(viewport);
  Object.defineProperty(viewport, 'clientHeight', { value: 256 });
  Object.defineProperty(option, 'offsetHeight', { value: 32 });
  const stop = observeTimeOptionViewport(list);
  resized();
  expect(list.style.paddingBlock).toBe('112px');
  stop();
  expect(disconnect).toHaveBeenCalledOnce();
});
