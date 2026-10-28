import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createScrollCompensation } from '../create-scroll-compensation';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
});

function setup() {
  const element = document.createElement('div');
  document.body.append(element);
  element.scrollTop = 1000;
  Object.defineProperties(element, {
    scrollHeight: { value: 5000 },
    clientHeight: { value: 500 },
  });
  let shift = 0;
  const writeOffset = vi.fn((offset: number) => {
    element.scrollTop = offset;
  });
  const compensation = createScrollCompensation({
    getElement: () => element,
    setAdjustment: (value) => {
      shift = value;
    },
    writeOffset,
  });
  const wheel = () =>
    compensation.onWheel(new WheelEvent('wheel', { deltaY: -20 }));
  return { element, compensation, writeOffset, wheel, shift: () => shift };
}

describe('gesture scroll compensation', () => {
  it('preserves native motion that has not reached the offset observer yet', () => {
    const f = setup();
    f.compensation.observeOffset(1000, false);
    f.wheel();
    f.element.scrollTop = 935;
    // TanStack prepends 2880px using its last reported offset of 1000px.
    f.compensation.defer(3880);
    expect(f.shift()).toBe(2880);
    // Another measurement before a scroll event shares the updated logical offset.
    f.compensation.defer(3980);
    expect(f.shift()).toBe(2980);
    expect(f.compensation.observeOffset(935, true)).toBe(3915);
    vi.advanceTimersByTime(150);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(3915);
  });

  it('keeps the reading anchor while measurements and native scrolling accumulate', () => {
    const f = setup();
    f.wheel();
    // A row above the viewport grows by 200px.
    expect(f.compensation.defer(1200)).toBe(true);
    expect(1300 - f.shift() - f.element.scrollTop).toBe(100);
    expect(f.writeOffset).not.toHaveBeenCalled();

    f.element.scrollTop -= 50;
    expect(f.compensation.observeOffset(950, true)).toBe(1150);
    // A second correction adds 80px to the same logical coordinate system.
    f.compensation.defer(1230);
    expect(f.shift()).toBe(280);
    expect(1380 - f.shift() - f.element.scrollTop).toBe(150);

    vi.advanceTimersByTime(150);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(1230);
    expect(f.shift()).toBe(0);
    expect(1380 - f.element.scrollTop).toBe(150);
  });

  it('preserves a shrinking-row adjustment and writes it once after momentum', () => {
    const f = setup();
    f.wheel();
    f.compensation.defer(800);
    vi.advanceTimersByTime(100);
    f.element.scrollTop = 970;
    expect(f.compensation.observeOffset(970, true)).toBe(770);
    // A native scrollend notification alone must not flush recent wheel input.
    f.compensation.observeOffset(970, false);
    vi.advanceTimersByTime(100);
    expect(f.writeOffset).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(770);
  });

  it('flushes before explicit navigation and does not replay the adjustment', () => {
    const f = setup();
    f.wheel();
    f.compensation.defer(1400);
    f.compensation.finish();
    f.element.scrollTop = 3000;
    expect(f.compensation.defer(3200)).toBe(false);
    vi.advanceTimersByTime(1000);
    expect(f.writeOffset).toHaveBeenCalledTimes(1);
    expect(f.compensation.logicalOffset(f.element.scrollTop)).toBe(3000);
  });

  it('does not extend the gesture when only async content keeps resizing', () => {
    const f = setup();
    f.wheel();
    f.compensation.defer(1200);
    vi.advanceTimersByTime(100);
    f.compensation.defer(1300);
    vi.advanceTimersByTime(50);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(1300);
  });

  it('releases the shifted origin when native scrolling reaches the top', () => {
    const f = setup();
    f.wheel();
    f.compensation.defer(1200);
    f.element.scrollTop = 0;
    expect(f.compensation.observeOffset(0, true)).toBe(200);
    expect(f.shift()).toBe(0);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(200);
  });

  it('does not write after disposal or detachment', () => {
    const f = setup();
    f.wheel();
    f.compensation.defer(1200);
    f.compensation.dispose();
    vi.advanceTimersByTime(1000);
    expect(f.writeOffset).not.toHaveBeenCalled();
    f.element.remove();
    f.compensation.finish();
    expect(f.writeOffset).not.toHaveBeenCalled();
  });

  it('releases negative compensation at the physical bottom', () => {
    const f = setup();
    f.wheel();
    f.compensation.defer(800);
    f.element.scrollTop = 4500;
    expect(f.compensation.observeOffset(4500, true)).toBe(4300);
    expect(f.shift()).toBe(0);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(4300);
  });

  it('leaves idle corrections and pinch zoom alone', () => {
    const f = setup();
    expect(f.compensation.defer(1200)).toBe(false);
    f.compensation.onWheel(
      new WheelEvent('wheel', { deltaY: 10, ctrlKey: true })
    );
    expect(f.compensation.defer(1200)).toBe(false);
  });

  it('waits for a held touch and its momentum, even after its row unmounts', () => {
    const f = setup();
    const row = document.createElement('div');
    f.element.append(row);
    f.element.addEventListener('touchstart', f.compensation.onTouchStart);
    row.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    f.compensation.defer(1200);
    vi.advanceTimersByTime(1000);
    expect(f.writeOffset).not.toHaveBeenCalled();

    row.remove();
    row.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(100);
    f.element.scrollTop = 950;
    expect(f.compensation.observeOffset(950, true)).toBe(1150);
    vi.advanceTimersByTime(100);
    expect(f.writeOffset).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(1150);
  });

  it('releases a cancelled touch and waits for the last finger', () => {
    const f = setup();
    f.element.addEventListener('touchstart', f.compensation.onTouchStart);
    f.element.dispatchEvent(new TouchEvent('touchstart'));
    f.compensation.defer(1200);
    f.element.dispatchEvent(
      new TouchEvent('touchend', { touches: [{} as Touch] })
    );
    vi.advanceTimersByTime(200);
    expect(f.writeOffset).not.toHaveBeenCalled();
    f.element.dispatchEvent(new TouchEvent('touchcancel', { touches: [] }));
    vi.advanceTimersByTime(150);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(1200);
  });

  it('waits for rubber-banding to return in bounds before flushing', () => {
    const f = setup();
    f.wheel();
    f.compensation.defer(1200);
    f.element.scrollTop = -40;
    expect(f.compensation.observeOffset(-40, true)).toBe(160);
    vi.advanceTimersByTime(500);
    expect(f.writeOffset).not.toHaveBeenCalled();
    f.element.scrollTop = 0;
    expect(f.compensation.observeOffset(0, true)).toBe(200);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(200);
  });

  it.each([
    { overscroll: -40, settled: 0, target: 1200, expected: 200 },
    { overscroll: 4540, settled: 4500, target: 800, expected: 4300 },
  ])(
    'retries rubber-banding at $overscroll without another scroll event',
    ({ overscroll, settled, target, expected }) => {
      const f = setup();
      f.wheel();
      f.compensation.defer(target);
      f.element.scrollTop = overscroll;
      vi.advanceTimersByTime(600);
      expect(f.writeOffset).not.toHaveBeenCalled();
      expect(f.shift()).toBe(target - 1000);

      f.element.scrollTop = settled;
      vi.advanceTimersByTime(150);
      expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(expected);
      expect(f.shift()).toBe(0);
      expect(f.compensation.defer(expected + 100)).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    }
  );

  it('tracks fingers on different rows until the final finger lifts', () => {
    const f = setup();
    const first = document.createElement('div');
    const second = document.createElement('div');
    f.element.append(first, second);
    f.element.addEventListener('touchstart', f.compensation.onTouchStart);
    first.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    second.dispatchEvent(new TouchEvent('touchstart', { bubbles: true }));
    f.compensation.defer(1200);
    second.dispatchEvent(
      new TouchEvent('touchend', { touches: [{} as Touch] })
    );
    vi.advanceTimersByTime(200);
    expect(f.writeOffset).not.toHaveBeenCalled();
    first.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(150);
    expect(f.writeOffset).toHaveBeenCalledExactlyOnceWith(1200);
  });
});
