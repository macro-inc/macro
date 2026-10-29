/** @vitest-environment jsdom */

import { createRoot, createSignal } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createFrameWidth } from './create-frame-width';

const resize = vi.hoisted(() => ({
  notify: (_size: unknown, _element: Element) => {},
}));
vi.mock('@solid-primitives/resize-observer', () => ({
  createResizeObserver: (
    _target: unknown,
    callback: (size: unknown, element: Element) => void
  ) => {
    resize.notify = callback;
  },
}));

const cleanups: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers({
    toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
  });
});

afterEach(() => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
});

function setup() {
  let layoutWidth = 1000;
  const element = document.createElement('div');
  element.getBoundingClientRect = () => new DOMRect(0, 0, layoutWidth, 600);
  const [target, setTarget] = createSignal<HTMLElement>();
  const width = createRoot((dispose) => {
    cleanups.push(dispose);
    return createFrameWidth(target);
  });
  return {
    width,
    element,
    mount: () => setTarget(element),
    resizeTo(next: number) {
      layoutWidth = next;
      resize.notify({ width: next, height: 600 }, element);
    },
  };
}

describe('createFrameWidth', () => {
  it('reads the width when the element mounts', () => {
    const view = setup();
    expect(view.width()).toBeUndefined();

    view.mount();

    expect(view.width()).toBe(1000);
  });

  it('applies observed widths in the next frame, not during delivery', () => {
    const view = setup();
    view.mount();

    view.resizeTo(700);
    expect(view.width()).toBe(1000);

    vi.advanceTimersToNextFrame();
    expect(view.width()).toBe(700);
  });

  it('coalesces several observations into the latest width', () => {
    const view = setup();
    view.mount();

    view.resizeTo(900);
    view.resizeTo(800);
    view.resizeTo(650);
    vi.advanceTimersToNextFrame();

    expect(view.width()).toBe(650);
  });

  it('drops a pending frame when disposed', () => {
    const view = setup();
    view.mount();
    view.resizeTo(500);

    for (const cleanup of cleanups.splice(0)) cleanup();
    vi.advanceTimersToNextFrame();

    expect(view.width()).toBe(1000);
  });
});
