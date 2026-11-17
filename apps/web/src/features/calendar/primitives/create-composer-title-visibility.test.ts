import { createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createComposerTitleVisibility } from './create-composer-title-visibility';

afterEach(() => vi.unstubAllGlobals());

it('uses the owned scroll root, resets on replacement, and disconnects', () => {
  const observers: ObserverStub[] = [];
  class ObserverStub implements IntersectionObserver {
    readonly root;
    readonly rootMargin = '0px';
    readonly scrollMargin = '0px';
    readonly thresholds = [0];
    disconnect = vi.fn();
    observe = vi.fn();
    unobserve = vi.fn();
    takeRecords = () => [];
    constructor(
      readonly callback: IntersectionObserverCallback,
      options?: IntersectionObserverInit
    ) {
      this.root = options?.root ?? null;
      observers.push(this);
    }
  }
  vi.stubGlobal('IntersectionObserver', ObserverStub);
  const state = createRoot((dispose) => {
    const scroller = document.createElement('div');
    const title = document.createElement('div');
    const [root, setRoot] = createSignal<HTMLElement | undefined>(scroller);
    const compact = createComposerTitleVisibility(root, () => title);
    return { dispose, scroller, title, setRoot, compact };
  });
  const observer = observers[0];
  const bounds = new DOMRect();
  const entries: IntersectionObserverEntry[] = [
    {
      target: state.title,
      isIntersecting: false,
      boundingClientRect: bounds,
      intersectionRect: bounds,
      rootBounds: bounds,
      intersectionRatio: 0,
      time: 0,
    },
  ];
  expect(observer.root).toBe(state.scroller);
  observer.callback(entries, observer);
  expect(state.compact()).toBe(false);
  state.scroller.scrollTop = 100;
  observer.callback(entries, observer);
  expect(state.compact()).toBe(true);
  state.setRoot(undefined);
  expect(state.compact()).toBe(false);
  expect(observer.disconnect).toHaveBeenCalledOnce();
  state.dispose();
});
