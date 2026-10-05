import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createDragAutoScroll } from './create-drag-auto-scroll';

const drag = vi.hoisted(() => ({
  active: (): boolean => false,
  pointer: { x: 390, y: 200 },
  detectCollisions: vi.fn(),
}));
vi.mock('@thisbeyond/solid-dnd', () => ({
  useDragDropContext: () => [
    {
      active: {
        get draggableId() {
          return drag.active() ? 'column' : null;
        },
        sensor: {
          coordinates: {
            get current() {
              return drag.pointer;
            },
          },
        },
      },
    },
    { detectCollisions: drag.detectCollisions },
  ],
}));

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  drag.detectCollisions.mockClear();
});

function setup(axis: 'x' | 'both' = 'x') {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const viewport = document.createElement('div');
  vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue(
    new DOMRect(0, 100, 400, 400)
  );
  Object.defineProperties(viewport, {
    scrollWidth: { value: 1000 },
    clientWidth: { value: 400 },
    scrollHeight: { value: 1000 },
    clientHeight: { value: 400 },
  });
  const [active, setActive] = createSignal(false);
  drag.active = active;
  drag.pointer = { x: 390, y: 200 };
  createRoot((cleanup) => {
    dispose = cleanup;
    createDragAutoScroll({ getViewport: () => viewport, axis });
  });
  const frame = (time: number) => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(time);
  };
  return { viewport, setActive, frame, frames };
}

describe('drag auto-scroll', () => {
  it('continues scrolling for a stationary edge pointer and stops as soon as the drag ends', () => {
    const { viewport, setActive, frame, frames } = setup();
    expect(frames.size).toBe(0);
    setActive(true);
    frame(0);
    frame(16);
    const first = viewport.scrollLeft;
    frame(32);
    expect(first).toBeGreaterThan(0);
    expect(viewport.scrollLeft).toBeGreaterThan(first);
    expect(drag.detectCollisions).toHaveBeenCalledTimes(2);
    expect(viewport.scrollTop).toBe(0);
    setActive(false);
    expect(frames.size).toBe(0);
    const stopped = viewport.scrollLeft;
    frame(48);
    expect(viewport.scrollLeft).toBe(stopped);
  });

  it('does not scroll in the center or beyond the viewport and clamps at the last column', () => {
    const { viewport, setActive, frame } = setup();
    setActive(true);
    frame(0);
    drag.pointer = { x: 200, y: 200 };
    frame(16);
    expect(viewport.scrollLeft).toBe(0);
    drag.pointer = { x: 410, y: 200 };
    frame(32);
    expect(viewport.scrollLeft).toBe(0);
    viewport.scrollLeft = 599;
    drag.pointer = { x: 399, y: 200 };
    frame(48);
    expect(viewport.scrollLeft).toBe(600);
    drag.pointer = { x: 1, y: 200 };
    frame(64);
    expect(viewport.scrollLeft).toBeLessThan(600);
  });

  it('scrolls vertically for boards and cancels its frame on unmount', () => {
    const { viewport, setActive, frame, frames } = setup('both');
    drag.pointer = { x: 200, y: 495 };
    setActive(true);
    frame(0);
    frame(16);
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(viewport.scrollLeft).toBe(0);
    dispose?.();
    dispose = undefined;
    expect(frames.size).toBe(0);
  });
});
