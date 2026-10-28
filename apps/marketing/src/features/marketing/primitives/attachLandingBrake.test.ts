import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { attachLandingBrake } from './attachLandingBrake';

let now = 100;
let frames = new Map<number, FrameRequestCallback>();
let dispose = () => {};
let nextId = 0;
beforeEach(() => {
  now = 100;
  nextId = 0;
  frames = new Map();
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
    frames.set(++nextId, callback);
    return nextId;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => frames.delete(id));
});
afterEach(() => {
  dispose();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});
function setup(position = 1100, reducedMotion = false) {
  const scroller = document.createElement('div');
  let top = position;
  Object.defineProperties(scroller, {
    clientHeight: { value: 800 },
    scrollTop: {
      get: () => top,
      set: (value: number) => {
        top = Math.round(value);
      },
    },
  });
  const reduced = Object.assign(new EventTarget(), {
    matches: reducedMotion,
    media: '',
    onchange: null,
    addListener() {},
    removeListener() {},
  }) as MediaQueryList;
  const brake = attachLandingBrake(
    scroller,
    reduced,
    () => ({ start: 1200, end: 1600 }),
    () => {}
  );
  dispose = brake.dispose;
  const wheel = (deltaY: number, options: WheelEventInit = {}) => {
    const event = new WheelEvent('wheel', {
      deltaY,
      cancelable: true,
      ...options,
    });
    scroller.dispatchEvent(event);
    return event.defaultPrevented;
  };
  return { scroller, brake, wheel };
}
function step() {
  now += 16;
  const callbacks = [...frames.values()];
  frames.clear();
  callbacks.forEach((callback) => callback(now));
}
describe('footer landing brake', () => {
  it('leaves ordinary scrolling, earlier content, zoom and horizontal input native', () => {
    const { wheel, scroller } = setup();
    expect(wheel(20)).toBe(false);
    expect(wheel(500, { ctrlKey: true })).toBe(false);
    expect(wheel(500, { deltaX: 600 })).toBe(false);
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
    expect(wheel(800)).toBe(false);
    expect(frames.size).toBe(0);
  });
  it('brakes a fast landing, reaches the exact bottom and stops even with rounded scroll positions', () => {
    const { wheel, scroller, brake } = setup();
    expect(wheel(600)).toBe(true);
    expect(scroller.scrollTop).toBe(1200);
    let previous = scroller.scrollTop;
    for (let i = 0; i < 70; i++) {
      step();
      expect(scroller.scrollTop).toBeGreaterThanOrEqual(previous);
      expect(scroller.scrollTop - previous).toBeLessThanOrEqual(30);
      expect(scroller.scrollTop).toBeLessThanOrEqual(1600);
      previous = scroller.scrollTop;
      scroller.dispatchEvent(new Event('scroll'));
    }
    expect(scroller.scrollTop).toBe(1600);
    expect(brake.isActive()).toBe(false);
    expect(frames.size).toBe(0);
  });
  it('releases immediately on reverse input and cancels queued work on disposal', () => {
    const { wheel, brake } = setup();
    wheel(500);
    step();
    expect(wheel(-30)).toBe(false);
    expect(brake.isActive()).toBe(false);
    expect(frames.size).toBe(0);
    wheel(500);
    expect(frames.size).toBe(1);
    brake.dispose();
    expect(frames.size).toBe(0);
    expect(wheel(500)).toBe(false);
  });
  it('does not brake reduced-motion scrolling or override keyboard navigation', () => {
    const reduced = setup(1100, true);
    expect(reduced.wheel(500)).toBe(false);
    reduced.brake.dispose();
    const normal = setup();
    normal.wheel(500);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home' }));
    expect(normal.brake.isActive()).toBe(false);
    expect(frames.size).toBe(0);
  });
});
