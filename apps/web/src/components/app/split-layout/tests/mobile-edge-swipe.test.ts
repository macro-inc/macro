import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMobileEdgeSwipe } from '../mobile/createMobileEdgeSwipe';

type Point = { x: number; time: number };

function touchEvent(type: string, time: number, x?: number) {
  const event = new Event(type, { bubbles: true, cancelable: true });
  const touches =
    x === undefined ? [] : [{ identifier: 1, clientX: x, clientY: 200 }];
  Object.defineProperty(event, 'touches', { value: touches });
  Object.defineProperty(event, 'timeStamp', { value: time });
  return event;
}

/**
 * Swipes from the left edge of a 390px pane through `moves`, then lifts the
 * finger at `releaseTime`, and reports whether the swipe completed.
 */
function swipe(start: Point, moves: Point[], releaseTime: number) {
  const pane = document.createElement('div');
  document.body.append(pane);
  vi.spyOn(pane, 'getBoundingClientRect').mockReturnValue(
    DOMRect.fromRect({ x: 0, y: 0, width: 390, height: 800 })
  );

  const onEnd = vi.fn();
  const gesture = createMobileEdgeSwipe({ enabled: () => true, onEnd });
  pane.addEventListener('touchstart', (event) =>
    gesture.handleTouchStart(event)
  );
  pane.addEventListener('touchmove', (event) => gesture.handleTouchMove(event));
  pane.addEventListener('touchend', (event) => gesture.handleTouchEnd(event));

  pane.dispatchEvent(touchEvent('touchstart', start.time, start.x));
  for (const move of moves) {
    pane.dispatchEvent(touchEvent('touchmove', move.time, move.x));
  }
  pane.dispatchEvent(touchEvent('touchend', releaseTime));

  expect(onEnd).toHaveBeenCalledOnce();
  return onEnd.mock.calls[0][0];
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

describe('edge swipe release', () => {
  it('completes a slow release past half the width', () => {
    const completed = swipe(
      { x: 10, time: 0 },
      [
        { x: 120, time: 500 },
        { x: 260, time: 1000 },
      ],
      1100
    );

    expect(completed).toBe(true);
  });

  it('completes a flick right after a slow drag that stayed short of half', () => {
    // Averaged over the whole drag this is about 0.13 px/ms, under the
    // threshold; the finger was moving at 1.5 px/ms when it lifted.
    const completed = swipe(
      { x: 10, time: 0 },
      [
        { x: 60, time: 500 },
        { x: 110, time: 1000 },
        { x: 125, time: 1010 },
        { x: 140, time: 1020 },
      ],
      1020
    );

    expect(completed).toBe(true);
  });

  it('cancels a flick back left even past half the width', () => {
    const completed = swipe(
      { x: 10, time: 0 },
      [
        { x: 300, time: 500 },
        { x: 320, time: 600 },
        { x: 290, time: 640 },
        { x: 270, time: 660 },
      ],
      660
    );

    expect(completed).toBe(false);
  });

  it('cancels a fast drag that rested short of half before lifting', () => {
    // Averaged from the touch start this is about 0.43 px/ms, but the
    // finger had stopped for 300ms when it lifted.
    const completed = swipe(
      { x: 10, time: 0 },
      [
        { x: 100, time: 50 },
        { x: 180, time: 100 },
      ],
      400
    );

    expect(completed).toBe(false);
  });
});
