import { cleanup, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { SwipableRow, SwipableRowProvider } from './SwipableRow';

vi.mock('@core/mobile/haptics', () => ({ hapticImpact: () => {} }));

beforeEach(() => {
  vi.useFakeTimers();
  // jsdom has no layout; give rows a phone's width so a short drag does not
  // count as dragging most of the way across.
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(390);
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function touch(target: Element, type: string, x?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches = x === undefined ? [] : [{ clientX: x, clientY: 20 }];
  Object.defineProperty(event, 'touches', { value: touches });
  target.dispatchEvent(event);
}

function swipe(from: number, to: number) {
  const row = screen.getByText('Row');
  touch(row, 'touchstart', from);
  const step = (to - from) / 10;
  for (let i = 1; i <= 10; i++) touch(row, 'touchmove', from + step * i);
  touch(row, 'touchend');
}

function renderRow() {
  const onSwipeLeft = vi.fn();
  const onSwipeRight = vi.fn();
  const canSwipeRight = vi.fn(() => true);
  render(() => {
    const [container, setContainer] = createSignal<HTMLElement>();
    return (
      <SwipableRowProvider
        container={container}
        onSwipeLeft={onSwipeLeft}
        onSwipeRight={onSwipeRight}
        canSwipeRight={canSwipeRight}
        triggerBehavior={{ left: 'fly-out', right: 'spring-back' }}
      >
        <div ref={setContainer}>
          <SwipableRow id="thread">
            <div>Row</div>
          </SwipableRow>
        </div>
      </SwipableRowProvider>
    );
  });
  const content = () =>
    screen.getByText('Row').closest<HTMLElement>('[data-swipe-content]')!;
  return { onSwipeLeft, onSwipeRight, canSwipeRight, content };
}

it('runs a spring-back right swipe inside the gesture and keeps the row', () => {
  const { onSwipeLeft, onSwipeRight, content } = renderRow();

  swipe(80, 230);

  // Synchronous, so an action that opens a sheet or keyboard still counts as
  // a user gesture on iOS.
  expect(onSwipeRight).toHaveBeenCalledWith('thread');
  expect(onSwipeLeft).not.toHaveBeenCalled();
  expect(content().style.transform).toBe('translateX(0px)');
});

it('still flies the row out for a left swipe', () => {
  const { onSwipeLeft, onSwipeRight, content } = renderRow();

  swipe(300, 150);

  expect(content().style.transform).toBe('translateX(-100%)');
  vi.advanceTimersByTime(100);
  expect(onSwipeLeft).toHaveBeenCalledWith('thread');
  expect(onSwipeRight).not.toHaveBeenCalled();
});

it('leaves right swipes from the left edge to back navigation', () => {
  const { onSwipeRight } = renderRow();

  swipe(10, 200);
  vi.runAllTimers();

  expect(onSwipeRight).not.toHaveBeenCalled();
});

it('asks whether a row can swipe once per gesture, not on every move', () => {
  const { canSwipeRight, onSwipeRight } = renderRow();

  swipe(80, 230);

  expect(onSwipeRight).toHaveBeenCalledOnce();
  expect(canSwipeRight).toHaveBeenCalledOnce();
});
