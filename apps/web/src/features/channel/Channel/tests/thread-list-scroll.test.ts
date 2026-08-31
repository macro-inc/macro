import { createScrollIntentTracker } from '@core/util/scroll-intent';
import type { JSX } from 'solid-js';
import { describe, expect, it } from 'vitest';

type Handler<E> = (event: E) => void;

/** Handler props are typed for JSX; call them directly in tests. */
const fire = <E>(handler: JSX.EventHandlerUnion<HTMLElement, E>, event: E) => {
  (handler as Handler<E>)(event);
};

const touchEvent = (...clientYs: number[]) =>
  ({
    touches: clientYs.map((clientY) => ({ clientY })),
  }) as unknown as TouchEvent;

describe('createScrollIntentTracker', () => {
  it('is not interacting by default', () => {
    const tracker = createScrollIntentTracker();
    expect(tracker.isUserInteracting()).toBe(false);
  });

  it('is interacting after markUserIntent', () => {
    const tracker = createScrollIntentTracker();
    tracker.markUserIntent('down');
    expect(tracker.isUserInteracting()).toBe(true);
  });

  it('stops interacting after timeout expires', () => {
    const tracker = createScrollIntentTracker();
    tracker.markUserIntent('down');
    const farFuture = Date.now() + 500;
    expect(tracker.isUserInteracting(farFuture)).toBe(false);
  });

  it('tracks last direction from markUserIntent', () => {
    const tracker = createScrollIntentTracker();
    expect(tracker.lastDirection()).toBe(undefined);

    tracker.markUserIntent('down');
    expect(tracker.lastDirection()).toBe('down');

    tracker.markUserIntent('up');
    expect(tracker.lastDirection()).toBe('up');
  });

  it('clears last direction after interaction expires', () => {
    const tracker = createScrollIntentTracker();
    tracker.markUserIntent('down');
    expect(tracker.lastDirection()).toBe('down');

    const farFuture = Date.now() + 500;
    expect(tracker.lastDirection(farFuture)).toBe(undefined);
  });

  it('is interacting while a finger is down', () => {
    const tracker = createScrollIntentTracker();
    fire(tracker.handlers.onTouchStart, touchEvent(400));
    // Well past the interaction timeout: the finger is still down.
    expect(tracker.isUserInteracting(Date.now() + 5000)).toBe(true);
  });

  it('reads a down direction from a finger dragging up', () => {
    const tracker = createScrollIntentTracker();
    fire(tracker.handlers.onTouchStart, touchEvent(400));
    fire(tracker.handlers.onTouchMove, touchEvent(300));
    expect(tracker.lastDirection()).toBe('down');
  });

  it('reads an up direction from a finger dragging down', () => {
    const tracker = createScrollIntentTracker();
    fire(tracker.handlers.onTouchStart, touchEvent(300));
    fire(tracker.handlers.onTouchMove, touchEvent(400));
    expect(tracker.lastDirection()).toBe('up');
  });

  it('ignores finger jitter below the direction threshold', () => {
    const tracker = createScrollIntentTracker();
    fire(tracker.handlers.onTouchStart, touchEvent(400));
    fire(tracker.handlers.onTouchMove, touchEvent(399));
    expect(tracker.lastDirection()).toBe(undefined);
  });

  it('keeps interacting through the momentum fling after the finger lifts', () => {
    const tracker = createScrollIntentTracker();
    fire(tracker.handlers.onTouchStart, touchEvent(400));
    fire(tracker.handlers.onTouchMove, touchEvent(300));
    fire(tracker.handlers.onTouchEnd, touchEvent());

    expect(tracker.lastDirection(Date.now() + 500)).toBe('down');
    expect(tracker.isUserInteracting(Date.now() + 2000)).toBe(false);
  });

  it('stays in the gesture while another finger is still down', () => {
    const tracker = createScrollIntentTracker();
    fire(tracker.handlers.onTouchStart, touchEvent(400, 380));
    fire(tracker.handlers.onTouchEnd, touchEvent(380));
    expect(tracker.isUserInteracting(Date.now() + 5000)).toBe(true);
  });
});
