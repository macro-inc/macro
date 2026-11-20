import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createViewStepper } from './createViewStepper';

const views = ['table', 'board', 'timeline'] as const;
let show: (visible: boolean) => void = () => {};
let reducedMotion = false;
let dispose = () => {};

beforeEach(() => {
  vi.useFakeTimers();
  reducedMotion = false;
  show = () => {};
  vi.stubGlobal('matchMedia', () => ({ matches: reducedMotion }));
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        show = (visible) =>
          callback(
            [{ isIntersecting: visible } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
      }
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup() {
  const element = document.createElement('div');
  const stepper = createRoot((disposeRoot) => {
    dispose = disposeRoot;
    return createViewStepper(views, () => element);
  });
  // onMount runs after the root's first render.
  vi.advanceTimersByTime(0);
  return stepper;
}

describe('createViewStepper', () => {
  it('steps through the views only while on screen', () => {
    const { view } = setup();
    vi.advanceTimersByTime(10_000);
    expect(view()).toBe('table');

    show(true);
    vi.advanceTimersByTime(3200);
    expect(view()).toBe('board');
    vi.advanceTimersByTime(6400);
    expect(view()).toBe('table');

    show(false);
    vi.advanceTimersByTime(10_000);
    expect(view()).toBe('table');
  });

  it('stays on a chosen view', () => {
    const { view, choose } = setup();
    show(true);
    choose('timeline');
    vi.advanceTimersByTime(10_000);
    expect(view()).toBe('timeline');

    show(false);
    show(true);
    vi.advanceTimersByTime(10_000);
    expect(view()).toBe('timeline');
  });

  it('does not step when motion is reduced', () => {
    reducedMotion = true;
    const { view } = setup();
    show(true);
    vi.advanceTimersByTime(10_000);
    expect(view()).toBe('table');
  });
});
