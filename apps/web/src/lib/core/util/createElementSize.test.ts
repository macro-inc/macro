import { createEffect, createRoot, createSignal } from 'solid-js';
import { afterEach, expect, it, vi } from 'vitest';
import { createElementSize } from './createElementSize';

let observer: ResizeObserver;
let deliver: (entries: ResizeObserverEntry[]) => void;
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();
class Observer implements ResizeObserver {
  observe = observe;
  unobserve = unobserve;
  disconnect = disconnect;
  constructor(callback: ResizeObserverCallback) {
    observer = this;
    deliver = (entries) => callback(entries, observer);
  }
}
function entry(
  target: HTMLElement,
  width: number,
  height: number
): ResizeObserverEntry {
  return {
    target,
    borderBoxSize: [{ inlineSize: width, blockSize: height }],
    contentBoxSize: [{ inlineSize: 50, blockSize: 20 }],
    contentRect: new DOMRectReadOnly(0, 0, 50, 20),
    devicePixelContentBoxSize: [],
  };
}
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

it('observes border-only changes without reading layout and tracks dimensions independently', () => {
  vi.stubGlobal('ResizeObserver', Observer);
  const element = document.createElement('div');
  const read = vi.spyOn(element, 'getBoundingClientRect');
  let widthRuns = 0;
  const scope = createRoot((dispose) => {
    const size = createElementSize(element);
    createEffect(() => {
      size.width;
      widthRuns++;
    });
    return { dispose, size };
  });
  expect(scope.size.width).toBeNull();
  expect(scope.size.height).toBeNull();
  expect(observe).toHaveBeenCalledWith(element, { box: 'border-box' });
  deliver([entry(element, 64, 32)]);
  expect(scope.size).toEqual({ width: 64, height: 32 });
  const measuredRuns = widthRuns;
  deliver([entry(element, 64, 40)]);
  expect(scope.size.height).toBe(40);
  expect(widthRuns).toBe(measuredRuns);
  // Content rect did not change: the observed border changed instead.
  deliver([entry(element, 72, 40)]);
  expect(scope.size.width).toBe(72);
  expect(read).not.toHaveBeenCalled();
  scope.dispose();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('resets on replacement and ignores queued entries from an old target', () => {
  vi.stubGlobal('ResizeObserver', Observer);
  const first = document.createElement('div');
  const next = document.createElement('div');
  const scope = createRoot((dispose) => {
    const [target, setTarget] = createSignal<HTMLElement>();
    const size = createElementSize(target);
    return { dispose, setTarget, size };
  });
  scope.setTarget(first);
  deliver([entry(first, 100, 20)]);
  expect(scope.size.width).toBe(100);
  scope.setTarget(next);
  expect(unobserve).toHaveBeenCalledWith(first);
  expect(scope.size.width).toBeNull();
  deliver([entry(first, 500, 500), entry(next, 200, 30)]);
  expect(scope.size).toEqual({ width: 200, height: 30 });
  scope.setTarget(undefined);
  expect(scope.size.width).toBeNull();
  expect(unobserve).toHaveBeenCalledWith(next);
  scope.dispose();
});
