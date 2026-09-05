import { createScrollIntentTracker } from '@core/util/scroll-intent';
import { describe, expect, it, vi } from 'vitest';

function scrollSurface(onUserIntent: () => void) {
  const tracker = createScrollIntentTracker(onUserIntent);
  const element = document.createElement('div');
  for (const [name, handler] of Object.entries(tracker.handlers)) {
    element.addEventListener(
      name.slice(2).toLowerCase(),
      handler as EventListener
    );
  }
  const dispatch = (type: string, properties: Record<string, unknown> = {}) =>
    element.dispatchEvent(Object.assign(new Event(type), properties));
  return { tracker, dispatch };
}

describe('createScrollIntentTracker', () => {
  it('does not cancel navigation for a touch tap with small finger movement', () => {
    const onUserIntent = vi.fn();
    const { dispatch } = scrollSurface(onUserIntent);
    dispatch('pointerdown', { pointerType: 'touch', clientY: 100 });
    dispatch('touchmove', { touches: [{ clientY: 98 }] });
    dispatch('pointerup', { pointerType: 'touch' });
    dispatch('touchend');
    expect(onUserIntent).not.toHaveBeenCalled();
  });

  it('tracks a native touch drag after the browser cancels pointer events', () => {
    const onUserIntent = vi.fn();
    const { tracker, dispatch } = scrollSurface(onUserIntent);
    dispatch('pointerdown', { pointerType: 'touch', clientY: 100 });
    // Native panning cancels Pointer Events; Touch Events continue until lift.
    dispatch('pointercancel', { pointerType: 'touch' });
    dispatch('touchmove', { touches: [{ clientY: 75 }] });
    expect(onUserIntent).toHaveBeenCalledOnce();
    expect(tracker.lastDirection()).toBe('down');
    expect(tracker.isUserInteracting(Date.now() + 1000)).toBe(true);
    dispatch('touchend');
    expect(tracker.isUserInteracting(Date.now() + 1000)).toBe(false);
  });

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
