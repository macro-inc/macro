import { createScrollIntentTracker } from '@core/util/scroll-intent';
import { describe, expect, it } from 'vitest';

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
});
