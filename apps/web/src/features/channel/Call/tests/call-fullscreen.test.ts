import { createRoot } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createCallFullscreen } from '../call-fullscreen';

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(document, 'fullscreenElement');
  Reflect.deleteProperty(document, 'exitFullscreen');
});

function fullscreenDocument() {
  let current: Element | null = null;
  Object.defineProperty(document, 'fullscreenElement', {
    configurable: true,
    get: () => current,
  });
  const change = (element: Element | null) => {
    current = element;
    document.dispatchEvent(new Event('fullscreenchange'));
  };
  const exit = vi.fn(async () => change(null));
  Object.defineProperty(document, 'exitFullscreen', {
    configurable: true,
    value: exit,
  });
  return { change, exit };
}

it('enters only the call area, tracks Escape, and toggles out', async () => {
  const doc = fullscreenDocument();
  const root = document.createElement('div');
  root.requestFullscreen = vi.fn(async () => doc.change(root));
  const state = createRoot((dispose) => ({
    ...createCallFullscreen(() => root),
    dispose,
  }));
  await state.toggle();
  expect(root.requestFullscreen).toHaveBeenCalledOnce();
  expect(state.active()).toBe(true);
  doc.change(null);
  expect(state.active()).toBe(false);
  await state.toggle();
  await state.toggle();
  expect(doc.exit).toHaveBeenCalledOnce();
  state.dispose();
});

it('exits owned fullscreen on cleanup but never exits another element', async () => {
  const doc = fullscreenDocument();
  const root = document.createElement('div');
  const state = createRoot((dispose) => ({
    ...createCallFullscreen(() => root),
    dispose,
  }));
  doc.change(document.createElement('div'));
  state.dispose();
  expect(doc.exit).not.toHaveBeenCalled();
  const owned = createRoot((dispose) => ({
    ...createCallFullscreen(() => root),
    dispose,
  }));
  doc.change(root);
  owned.dispose();
  expect(doc.exit).toHaveBeenCalledOnce();
});

it('does not enter when the fullscreen API is unavailable', async () => {
  fullscreenDocument();
  const state = createRoot((dispose) => ({
    ...createCallFullscreen(() => document.createElement('div')),
    dispose,
  }));
  expect(state.available()).toBe(false);
  await state.toggle();
  state.dispose();
});

it('remembers its fullscreen element when the render ref is cleared before cleanup', async () => {
  const doc = fullscreenDocument();
  const element = document.createElement('div');
  let root: HTMLElement | undefined = element;
  element.requestFullscreen = vi.fn(async () => doc.change(element));
  const state = createRoot((dispose) => ({
    ...createCallFullscreen(() => root),
    dispose,
  }));
  await state.toggle();
  root = undefined;
  state.dispose();
  expect(doc.exit).toHaveBeenCalledOnce();
});
