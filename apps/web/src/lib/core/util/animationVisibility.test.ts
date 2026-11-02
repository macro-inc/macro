import { createRoot } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { pauseOffscreenAnimations } from './animationVisibility';

let notify: (element: Element, intersecting: boolean) => void;
const observe = vi.fn();
const unobserve = vi.fn();
const disconnect = vi.fn();
const createObserver = vi.fn();

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal(
    'IntersectionObserver',
    class {
      constructor(callback: IntersectionObserverCallback) {
        createObserver();
        notify = (target, isIntersecting) =>
          callback(
            [{ target, isIntersecting } as IntersectionObserverEntry],
            this as unknown as IntersectionObserver
          );
      }
      observe = observe;
      unobserve = unobserve;
      disconnect = disconnect;
    }
  );
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it('shares viewport observation and restores each owner on disposal', async () => {
  const first = document.createElement('span');
  const second = document.createElement('span');
  first.style.setProperty('--animation-play-state', 'paused');
  const dispose = createRoot((dispose) => {
    pauseOffscreenAnimations(first);
    pauseOffscreenAnimations(second);
    return dispose;
  });
  expect(createObserver).toHaveBeenCalledOnce();
  expect(observe).toHaveBeenCalledTimes(2);
  notify(first, false);
  expect(first.style.getPropertyValue('--animation-play-state')).toBe('paused');
  expect(second.style.getPropertyValue('--animation-play-state')).toBe(
    'running'
  );
  dispose();
  expect(unobserve).toHaveBeenCalledTimes(2);
  expect(first.style.getPropertyValue('--animation-play-state')).toBe('paused');
  expect(second.style.getPropertyValue('--animation-play-state')).toBe('');
  await Promise.resolve();
  expect(disconnect).toHaveBeenCalledOnce();
});

it('resumes only SVG timelines paused by this owner', async () => {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  let paused = true;
  svg.animationsPaused = () => paused;
  svg.pauseAnimations = vi.fn(() => {
    paused = true;
  });
  svg.unpauseAnimations = vi.fn(() => {
    paused = false;
  });
  const dispose = createRoot((dispose) => {
    pauseOffscreenAnimations(svg);
    return dispose;
  });
  notify(svg, false);
  notify(svg, true);
  expect(svg.unpauseAnimations).not.toHaveBeenCalled();
  paused = false;
  notify(svg, false);
  expect(svg.pauseAnimations).toHaveBeenCalledOnce();
  notify(svg, true);
  expect(svg.unpauseAnimations).toHaveBeenCalledOnce();
  dispose();
  await Promise.resolve();
});
