import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createSnapPager } from './SnapPager';

const detach: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  detach.splice(0).forEach((close) => close());
  vi.useRealTimers();
});
function setup() {
  const onSettle = vi.fn();
  const pager = createSnapPager({
    instantWheel: () => true,
    rapidPressMs: 300,
    onSettle,
  });
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 100 });
  Object.defineProperty(element, 'onscrollend', { value: null });
  element.scrollTo = vi.fn((value?: ScrollToOptions | number) => {
    if (typeof value === 'object' && value.behavior === 'instant')
      element.scrollLeft = value.left ?? 0;
  });
  detach.push(pager.attachViewport(element));
  vi.mocked(element.scrollTo).mockClear();
  const wheel = (deltaX: number, deltaY = 0) => {
    const event = new WheelEvent('wheel', { deltaX, deltaY, cancelable: true });
    element.dispatchEvent(event);
    return event;
  };
  return { pager, element, wheel, onSettle };
}
it('jumps once for a horizontal burst including inertia and settles once after quiet', () => {
  const { pager, wheel, onSettle } = setup();
  for (const delta of [40, 35, 20, 8, 4]) {
    expect(wheel(delta).defaultPrevented).toBe(true);
    vi.advanceTimersByTime(60);
  }
  expect(pager.position()).toBe(1);
  expect(onSettle).not.toHaveBeenCalled();
  vi.advanceTimersByTime(300);
  expect(onSettle).toHaveBeenCalledExactlyOnceWith(1);
});
it('accepts a distinct gesture after the wheel quiet window', () => {
  const { pager, wheel } = setup();
  wheel(40);
  vi.advanceTimersByTime(190);
  wheel(40);
  expect(pager.position()).toBe(2);
});
it('ignores vertical-dominant wheel input and small jitter', () => {
  const { pager, wheel } = setup();
  expect(wheel(8, 40).defaultPrevented).toBe(false);
  expect(wheel(2).defaultPrevented).toBe(false);
  expect(pager.position()).toBe(0);
});
it('ignores button presses during an animation without extending the burst', () => {
  const { pager, element } = setup();
  pager.next();
  vi.advanceTimersByTime(100);
  pager.next();
  pager.previous();
  expect(pager.targetPosition()).toBe(1);
  expect(element.scrollTo).toHaveBeenCalledTimes(1);
  element.scrollLeft = 300;
  element.dispatchEvent(new Event('scrollend'));
  vi.advanceTimersByTime(301);
  pager.next();
  expect(element.scrollTo).toHaveBeenLastCalledWith({
    left: 300,
    behavior: 'smooth',
  });
});
it('always accepts a press right after animation completion and every idle rapid press', () => {
  const { pager, element, onSettle } = setup();
  pager.next();
  vi.advanceTimersByTime(100);
  element.scrollLeft = 300;
  element.dispatchEvent(new Event('scrollend'));
  pager.next();
  expect(pager.position()).toBe(2);
  expect(element.scrollTo).toHaveBeenLastCalledWith({
    left: 200,
    behavior: 'instant',
  });
  for (let count = 0; count < 5; count++) {
    pager.next();
    vi.advanceTimersByTime(20);
  }
  expect(pager.position()).toBe(7);
  vi.advanceTimersByTime(300);
  expect(onSettle).toHaveBeenCalledExactlyOnceWith(7);
});
it('re-arms animation after an idle quiet window', () => {
  const { pager, element } = setup();
  pager.next();
  element.scrollLeft = 300;
  element.dispatchEvent(new Event('scrollend'));
  vi.advanceTimersByTime(301);
  pager.previous();
  expect(element.scrollTo).toHaveBeenLastCalledWith({
    left: 100,
    behavior: 'smooth',
  });
});
it('ignores a press during a long-running animation even after the quiet window', () => {
  const { pager, element } = setup();
  pager.next();
  vi.advanceTimersByTime(301);
  pager.previous();
  expect(pager.targetPosition()).toBe(1);
  expect(element.scrollTo).toHaveBeenCalledTimes(1);
});
it('a gesture interrupts a button animation with one direct jump', () => {
  const { pager, element, wheel, onSettle } = setup();
  pager.next();
  vi.advanceTimersByTime(50);
  wheel(40);
  expect(pager.position()).toBe(2);
  expect(element.scrollTo).toHaveBeenLastCalledWith({
    left: 200,
    behavior: 'instant',
  });
  vi.advanceTimersByTime(300);
  expect(onSettle).toHaveBeenCalledExactlyOnceWith(2);
});

it('waits for an ongoing desktop button animation instead of settling a partial position', () => {
  const { pager, element, onSettle } = setup();
  pager.next();
  element.scrollLeft = 240;
  element.dispatchEvent(new Event('scroll'));
  vi.advanceTimersByTime(500);
  expect(pager.position()).toBe(0);
  expect(onSettle).not.toHaveBeenCalled();
  element.scrollLeft = 300;
  element.dispatchEvent(new Event('scrollend'));
  expect(pager.position()).toBe(1);
  expect(onSettle).toHaveBeenCalledExactlyOnceWith(1);
});
it('disables native horizontal overflow for discrete desktop wheel navigation', () => {
  const { element } = setup();
  expect(element.classList.contains('snap-pager-discrete')).toBe(true);
});

it('applies a desktop wheel step after an already queued date jump', () => {
  const { pager, element, wheel } = setup();
  element.dispatchEvent(new Event('touchstart'));
  pager.goTo(5);
  wheel(40);
  expect(pager.position()).toBe(6);
});
