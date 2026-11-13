import { fireEvent } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMobileSwipeBackGesture } from '../mobile/createMobileSwipeBackGesture';

const disposers: Array<() => void> = [];

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal('innerWidth', 390);
});
afterEach(() => {
  for (const dispose of disposers.splice(0)) dispose();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function setup(inPane: boolean, paneBack = true) {
  let available = inPane;
  const routeBack = vi.fn();
  const closePane = vi.fn();
  const gesture = createRoot((dispose) => {
    disposers.push(dispose);
    return createMobileSwipeBackGesture({
      animationMs: 88,
      bgPeekOffset: 110,
      edgeThreshold: 40,
      velocityThreshold: 0.3,
      distanceThreshold: 0.5,
      canStart: () => true,
      inPaneBack: { canGoBack: () => available, goBack: routeBack },
      stack: {
        front: () => undefined,
        behind: () => undefined,
        canGoBack: () => paneBack,
        goBack: closePane,
        completeGoBack: closePane,
        setAnimatedTrigger: () => {},
        setForwardTrigger: () => {},
      },
    });
  });
  const target = document.createElement('div');
  target.addEventListener('touchstart', gesture.handleTouchStart);
  target.addEventListener('touchmove', gesture.handleTouchMove);
  target.addEventListener('touchend', gesture.handleTouchEnd);
  target.addEventListener('touchcancel', gesture.handleTouchCancel);
  return {
    gesture,
    target,
    routeBack,
    closePane,
    expire: () => {
      available = false;
    },
  };
}

describe('native in-pane swipe Back', () => {
  it('pops the route without revealing or closing another pane, including at the root', () => {
    const test = setup(true, false);
    fireEvent.touchStart(test.target, { touches: [{ clientX: 8 }] });
    fireEvent.touchMove(test.target, { touches: [{ clientX: 250 }] });
    expect(test.gesture.styleForSlot(true).transform).toBe('none');
    fireEvent.touchEnd(test.target);
    expect(test.routeBack).toHaveBeenCalledOnce();
    expect(test.closePane).not.toHaveBeenCalled();
    expect(test.gesture.isAnimatingOut()).toBe(false);
  });

  it('leaves a canceled or short swipe on the current route', () => {
    const test = setup(true);
    fireEvent.touchStart(test.target, { touches: [{ clientX: 8 }] });
    fireEvent.touchMove(test.target, { touches: [{ clientX: 250 }] });
    fireEvent.touchCancel(test.target);
    fireEvent.touchStart(test.target, { touches: [{ clientX: 8 }] });
    vi.advanceTimersByTime(1000);
    fireEvent.touchMove(test.target, { touches: [{ clientX: 28 }] });
    fireEvent.touchEnd(test.target);
    expect(test.routeBack).not.toHaveBeenCalled();
    expect(test.closePane).not.toHaveBeenCalled();
    expect(test.gesture.isDragging()).toBe(false);
  });

  it('does not close a pane if the route changes during the gesture', () => {
    const test = setup(true);
    fireEvent.touchStart(test.target, { touches: [{ clientX: 8 }] });
    fireEvent.touchMove(test.target, { touches: [{ clientX: 250 }] });
    test.expire();
    fireEvent.touchEnd(test.target);
    expect(test.routeBack).not.toHaveBeenCalled();
    expect(test.closePane).not.toHaveBeenCalled();
  });

  it('retains the animated pane closure outside in-pane navigation', () => {
    const test = setup(false);
    fireEvent.touchStart(test.target, { touches: [{ clientX: 8 }] });
    fireEvent.touchMove(test.target, { touches: [{ clientX: 250 }] });
    fireEvent.touchEnd(test.target);
    expect(test.gesture.isAnimatingOut()).toBe(true);
    expect(test.closePane).not.toHaveBeenCalled();
    vi.advanceTimersByTime(88);
    expect(test.closePane).toHaveBeenCalledOnce();
    expect(test.routeBack).not.toHaveBeenCalled();
  });
});
