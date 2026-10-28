import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createPointerAutoScroll } from './create-pointer-auto-scroll';

let dispose: (() => void) | undefined;
afterEach(() => {
  dispose?.();
  dispose = undefined;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function setup(allowOutside = true) {
  const frames = new Map<number, FrameRequestCallback>();
  let sequence = 0;
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++sequence, callback);
    return sequence;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
  const viewport = document.createElement('div');
  const bounds = new DOMRect(0, 228, 400, 272);
  const pointer = { x: 200, y: 495 };
  const onScroll = vi.fn();
  Object.defineProperties(viewport, {
    scrollWidth: { value: 1000 },
    clientWidth: { value: 400 },
    scrollHeight: { value: 1000 },
    clientHeight: { value: 400 },
  });
  let autoScroll!: ReturnType<typeof createPointerAutoScroll>;
  createRoot((cleanup) => {
    dispose = cleanup;
    autoScroll = createPointerAutoScroll({
      getViewport: () => viewport,
      getPointer: () => pointer,
      getBounds: () => bounds,
      axis: 'y',
      allowOutside,
      onScroll,
    });
  });
  const frame = (time: number) => {
    const pending = [...frames.values()];
    frames.clear();
    for (const callback of pending) callback(time);
  };
  return { viewport, pointer, bounds, autoScroll, frame, frames, onScroll };
}

describe('pointer auto-scroll', () => {
  it('keeps scrolling beyond the window at a bounded speed without moving horizontally', () => {
    const { viewport, pointer, autoScroll, frame, frames, onScroll } = setup();
    pointer.x = -1000;
    pointer.y = 2500;
    viewport.scrollLeft = 37;
    autoScroll.start();
    autoScroll.start();
    expect(frames.size).toBe(1);
    frame(0);
    frame(16);
    expect(viewport.scrollTop).toBeCloseTo(11.2);
    frame(32);
    expect(viewport.scrollTop).toBeCloseTo(22.4);
    expect(viewport.scrollLeft).toBe(37);
    expect(onScroll).toHaveBeenCalledTimes(2);
    autoScroll.stop();
    expect(frames.size).toBe(0);
    frame(48);
    expect(viewport.scrollTop).toBeCloseTo(22.4);
  });

  it('uses the content edge below sticky headers and clamps both scroll boundaries', () => {
    const { viewport, pointer, autoScroll, frame, onScroll } = setup();
    viewport.scrollTop = 100;
    pointer.y = 230;
    autoScroll.start();
    frame(0);
    frame(16);
    expect(viewport.scrollTop).toBeLessThan(100);
    viewport.scrollTop = 1;
    pointer.y = -1000;
    frame(32);
    expect(viewport.scrollTop).toBe(0);
    viewport.scrollTop = 599;
    pointer.y = 2500;
    frame(48);
    expect(viewport.scrollTop).toBe(600);
    onScroll.mockClear();
    frame(64);
    expect(onScroll).not.toHaveBeenCalled();
  });

  it('leaves center pointers and hidden content still', () => {
    const { viewport, pointer, bounds, autoScroll, frame } = setup();
    pointer.y = 350;
    autoScroll.start();
    frame(0);
    frame(16);
    expect(viewport.scrollTop).toBe(0);
    bounds.y = window.innerHeight + 1;
    pointer.y = 2500;
    frame(32);
    expect(viewport.scrollTop).toBe(0);
  });

  it('preserves opt-in outside scrolling and limits long frame gaps', () => {
    const { viewport, pointer, autoScroll, frame } = setup(false);
    pointer.x = 410;
    autoScroll.start();
    frame(0);
    frame(16);
    expect(viewport.scrollTop).toBe(0);
    pointer.x = 200;
    pointer.y = 500;
    frame(1000);
    expect(viewport.scrollTop).toBeCloseTo(22.4);
  });

  it('does not restart when the scroll callback stops the loop and cancels on unmount', () => {
    const { autoScroll, onScroll, frame, frames } = setup();
    onScroll.mockImplementation(() => autoScroll.stop());
    autoScroll.start();
    frame(0);
    frame(16);
    expect(frames.size).toBe(0);
    autoScroll.start();
    expect(frames.size).toBe(1);
    dispose?.();
    dispose = undefined;
    expect(frames.size).toBe(0);
  });
});
