import { createScrollIntentTracker } from '@core/util/scroll-intent';
import { describe, expect, it, vi } from 'vitest';
import { createScrollSource } from '../create-scroll-source';

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

describe('createScrollSource', () => {
  function source(interacting = false) {
    let isInteracting = interacting;
    const scrollSource = createScrollSource(() => isInteracting);
    const scroll = (offset: number, isScrolling = true) => {
      const isUserScroll = scrollSource.classify(offset, isScrolling);
      scrollSource.release(isUserScroll);
      return isUserScroll;
    };
    return {
      scrollSource,
      scroll,
      setInteracting: (value: boolean) => {
        isInteracting = value;
      },
    };
  }

  it('reports a gesture and its momentum until the end event', () => {
    const { scrollSource, scroll, setInteracting } = source(true);
    expect(scroll(100)).toBe(true);
    setInteracting(false);
    expect(scroll(180)).toBe(true);
    expect(scrollSource.isGestureActive()).toBe(true);
    expect(scroll(180, false)).toBe(false);
    expect(scrollSource.isGestureActive()).toBe(false);
  });

  it('does not report an instant programmatic scroll', () => {
    const { scrollSource, scroll } = source();
    scrollSource.markProgrammatic(640);
    expect(scroll(640.5)).toBe(false);
  });

  it('does not report the browser clamping scrollTop after content shrank', () => {
    const { scrollSource, scroll } = source();
    scrollSource.markProgrammatic(1233);
    expect(scroll(1233)).toBe(false);
    // No scrollend follows a clamp, so a misreport here would hold iOS size
    // compensation until the next real scroll.
    expect(scroll(1224)).toBe(false);
    expect(scrollSource.isGestureActive()).toBe(false);
  });

  it('keeps the gesture active while the end event is being handled', () => {
    const { scrollSource, setInteracting } = source(true);
    expect(scrollSource.classify(100, true)).toBe(true);
    scrollSource.release(true);
    setInteracting(false);
    const isUserScroll = scrollSource.classify(100, false);
    expect(isUserScroll).toBe(false);
    expect(scrollSource.isGestureActive()).toBe(true);
    scrollSource.release(isUserScroll);
    expect(scrollSource.isGestureActive()).toBe(false);
  });
});
