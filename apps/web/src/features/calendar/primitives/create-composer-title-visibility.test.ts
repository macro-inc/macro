import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import {
  composerTitleProgress,
  createComposerTitleVisibility,
} from './create-composer-title-visibility';

afterEach(() => vi.unstubAllGlobals());

it('tracks forward and reverse offsets continuously over twenty-four pixels', () => {
  const offsets = [12, 40, 46, 52, 58, 64, 90, 64, 58, 52, 46, 40, 12];
  expect(offsets.map((offset) => composerTitleProgress(offset, 40))).toEqual([
    0, 0, 0.25, 0.5, 0.75, 1, 1, 1, 0.75, 0.5, 0.25, 0, 0,
  ]);
});

it('measures the title in its scroll root and removes pending work on replacement', () => {
  const frames: FrameRequestCallback[] = [];
  const request = vi.fn((callback: FrameRequestCallback) =>
    frames.push(callback)
  );
  const cancel = vi.fn();
  const observers: ResizeObserverStub[] = [];
  class ResizeObserverStub {
    observe = vi.fn();
    disconnect = vi.fn();
    constructor(readonly callback: ResizeObserverCallback) {
      observers.push(this);
    }
  }
  vi.stubGlobal('requestAnimationFrame', request);
  vi.stubGlobal('cancelAnimationFrame', cancel);
  vi.stubGlobal('ResizeObserver', ResizeObserverStub);
  const scroller = document.createElement('div');
  const title = document.createElement('textarea');
  scroller.getBoundingClientRect = () => new DOMRect(0, 100, 300, 400);
  title.style.lineHeight = '30px';
  title.getBoundingClientRect = () =>
    new DOMRect(0, 140 - scroller.scrollTop, 200, 90);
  const state = createRoot((dispose) => {
    const [root, setRoot] = createSignal<HTMLElement | undefined>(scroller);
    const progress = createComposerTitleVisibility(root, () => title);
    return { dispose, setRoot, progress };
  });
  frames.shift()?.(0);
  expect(state.progress()).toBe(0);
  expect(observers[0].observe.mock.calls).toEqual([[scroller], [title]]);

  scroller.scrollTop = 82;
  scroller.dispatchEvent(new Event('scroll'));
  scroller.dispatchEvent(new Event('scroll'));
  expect(frames).toHaveLength(1);
  frames.shift()?.(0);
  expect(state.progress()).toBe(0.5);

  scroller.scrollTop = 94;
  scroller.dispatchEvent(new Event('scroll'));
  frames.shift()?.(0);
  expect(state.progress()).toBe(1);
  scroller.scrollTop = 76;
  scroller.dispatchEvent(new Event('scroll'));
  frames.shift()?.(0);
  expect(state.progress()).toBe(0.25);

  scroller.dispatchEvent(new Event('scroll'));
  state.setRoot(undefined);
  expect(state.progress()).toBe(0);
  expect(observers[0].disconnect).toHaveBeenCalledOnce();
  expect(cancel).toHaveBeenCalledOnce();
  const requestCount = request.mock.calls.length;
  scroller.dispatchEvent(new Event('scroll'));
  window.dispatchEvent(new Event('resize'));
  expect(request).toHaveBeenCalledTimes(requestCount);
  state.dispose();
});
