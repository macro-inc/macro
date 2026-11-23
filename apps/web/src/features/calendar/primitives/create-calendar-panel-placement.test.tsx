import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createCalendarPanelPlacement } from './create-calendar-panel-placement';

let resized: () => void;
let frame: FrameRequestCallback | undefined;
beforeEach(() => {
  vi.stubGlobal('innerHeight', 800);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frame = callback;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  vi.stubGlobal(
    'ResizeObserver',
    class {
      constructor(callback: () => void) {
        resized = callback;
      }
      observe() {}
      disconnect() {}
    }
  );
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  frame = undefined;
});

function setup(options: { top: number; height: number; pinned?: boolean }) {
  const surface = document.createElement('div');
  const boundary = document.createElement('div');
  const dock = document.createElement('div');
  let height = options.height;
  surface.getBoundingClientRect = () =>
    new DOMRect(400, options.top, 384, height);
  boundary.getBoundingClientRect = () => new DOMRect(0, 100, 1200, 660);
  dock.getBoundingClientRect = () => new DOMRect(0, 100, 384, 660);
  let placement!: ReturnType<typeof createCalendarPanelPlacement>;
  const view = render(() => {
    placement = createCalendarPanelPlacement({
      boundary: () => boundary,
      dock: () => dock,
      surface: () => surface,
      anchor: () => new DOMRect(392, options.top, 8, 30),
      pinned: () => options.pinned ?? false,
      disabled: () => false,
      onPin: () => {},
      onUnpin: () => {},
    });
    return <output>{placement.anchorRect().top}</output>;
  });
  return {
    placement,
    view,
    setHeight(value: number) {
      height = value;
    },
  };
}

it('moves a bottom-anchored card upward instead of shrinking its natural height', () => {
  const { placement } = setup({ top: 700, height: 500 });
  expect(placement.maxHeight()).toBe(768);
  expect(placement.anchorRect().top).toBe(284);
});

it('does not move a card that already fits', () => {
  const { placement } = setup({ top: 200, height: 500 });
  expect(placement.maxHeight()).toBe(768);
  expect(placement.anchorRect().top).toBe(200);
});

it('caps only a card taller than the available viewport', () => {
  const { placement } = setup({ top: 600, height: 1000 });
  expect(placement.maxHeight()).toBe(768);
  expect(placement.anchorRect().top).toBe(16);
});

it('moves up after fields expand without reducing available height', () => {
  const { placement, view, setHeight } = setup({ top: 600, height: 150 });
  expect(view.container.textContent).toBe('600');
  setHeight(500);
  resized();
  frame?.(0);
  expect(view.container.textContent).toBe('284');
  expect(placement.maxHeight()).toBe(768);
});

it('uses the new viewport height after resizing', () => {
  const { placement } = setup({ top: 700, height: 500 });
  vi.stubGlobal('innerHeight', 600);
  window.dispatchEvent(new Event('resize'));
  frame?.(0);
  expect(placement.anchorRect().top).toBe(84);
  expect(placement.maxHeight()).toBe(568);
});

it('preserves pinned geometry rather than using the floating viewport', () => {
  const { placement } = setup({ top: 700, height: 500, pinned: true });
  expect(placement.maxHeight()).toBe(660);
  expect(placement.anchorRect()).toEqual(new DOMRect(0, 100, 0, 660));
});
