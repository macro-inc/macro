import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTargetReplyScroller } from '../create-target-reply-scroller';

class ResizeObserverMock {
  static instances: ResizeObserverMock[] = [];

  readonly observe = vi.fn();
  readonly unobserve = vi.fn();
  readonly disconnect = vi.fn();

  constructor(private readonly callback: ResizeObserverCallback) {
    ResizeObserverMock.instances.push(this);
  }

  trigger() {
    this.callback([], this as unknown as ResizeObserver);
  }
}

const rect = (top: number, bottom: number): DOMRect =>
  ({
    x: 0,
    y: top,
    width: 500,
    height: bottom - top,
    top,
    right: 500,
    bottom,
    left: 0,
    toJSON: () => ({}),
  }) as DOMRect;

describe('createTargetReplyScroller', () => {
  let animationFrames: Map<number, FrameRequestCallback>;
  let nextAnimationFrameId: number;

  const flushAnimationFrame = () => {
    const callbacks = [...animationFrames.values()];
    animationFrames.clear();
    for (const callback of callbacks) callback(performance.now());
  };

  beforeEach(() => {
    vi.useFakeTimers();
    ResizeObserverMock.instances = [];
    animationFrames = new Map();
    nextAnimationFrameId = 1;

    vi.stubGlobal('ResizeObserver', ResizeObserverMock);
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => {
      const id = nextAnimationFrameId++;
      animationFrames.set(id, callback);
      return id;
    });
    vi.stubGlobal('cancelAnimationFrame', (id: number) => {
      animationFrames.delete(id);
    });
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const createFixture = () => {
    const scrollElement = document.createElement('div');
    scrollElement.dataset.channelScroll = '';
    const virtualItem = document.createElement('div');
    const threadRow = document.createElement('div');
    threadRow.dataset.channelThreadRow = '';
    const target = document.createElement('div');
    threadRow.append(target);
    virtualItem.append(threadRow);
    scrollElement.append(virtualItem);
    document.body.append(scrollElement);

    let targetRect = rect(1000, 1050);
    let scrollRect = rect(0, 600);
    vi.spyOn(scrollElement, 'getBoundingClientRect').mockImplementation(
      () => scrollRect
    );
    vi.spyOn(target, 'getBoundingClientRect').mockImplementation(
      () => targetRect
    );
    const scrollIntoView = vi.fn(() => {
      targetRect = rect(275, 325);
    });
    target.scrollIntoView = scrollIntoView;

    return {
      scrollElement,
      virtualItem,
      threadRow,
      target,
      scrollIntoView,
      setTargetRect: (next: DOMRect) => {
        targetRect = next;
      },
      setScrollRect: (next: DOMRect) => {
        scrollRect = next;
      },
    };
  };

  /** A touch event carrying one contact point, as the scroll surface sees it. */
  const touchEvent = (type: string, x: number, y: number) => {
    const event = new Event(type, { bubbles: true });
    Object.defineProperty(event, 'touches', {
      value: [{ clientX: x, clientY: y }],
    });
    return event;
  };

  it('waits for the expanded thread row measurement before positioning', async () => {
    const fixture = createFixture();
    const onSettled = vi.fn();
    const scroller = createTargetReplyScroller({
      getTarget: () => fixture.target,
    });

    expect(scroller.scrollToIndex(0, onSettled)).toBe(true);
    flushAnimationFrame();
    expect(fixture.scrollIntoView).not.toHaveBeenCalled();

    ResizeObserverMock.instances[0].trigger();
    await Promise.resolve();
    expect(fixture.scrollIntoView).toHaveBeenCalledTimes(1);
    flushAnimationFrame();
    flushAnimationFrame();
    expect(fixture.scrollIntoView).toHaveBeenCalledTimes(2);

    fixture.setTargetRect(rect(1000, 1050));
    ResizeObserverMock.instances[0].trigger();
    await Promise.resolve();
    expect(fixture.scrollIntoView).toHaveBeenCalledTimes(3);
    flushAnimationFrame();
    flushAnimationFrame();
    expect(fixture.scrollIntoView).toHaveBeenCalledTimes(4);

    vi.advanceTimersByTime(200);
    expect(onSettled).toHaveBeenCalledOnce();
    expect(ResizeObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
  });

  it('positions through the outer virtualizer after sibling resize observers', async () => {
    const fixture = createFixture();
    let virtualizerMeasurementApplied = false;
    const positionTarget = vi.fn(() => virtualizerMeasurementApplied);
    const scroller = createTargetReplyScroller({
      getTarget: () => fixture.target,
      positionTarget,
    });

    expect(scroller.scrollToIndex(0, vi.fn())).toBe(true);
    ResizeObserverMock.instances[0].trigger();
    expect(positionTarget).not.toHaveBeenCalled();
    // Simulate Virtua's ResizeObserver running later in the same delivery.
    virtualizerMeasurementApplied = true;
    await Promise.resolve();
    flushAnimationFrame();
    flushAnimationFrame();

    expect(positionTarget).toHaveBeenCalledWith(
      fixture.threadRow,
      fixture.target
    );
    expect(fixture.scrollIntoView).not.toHaveBeenCalled();
  });

  it('repositions before paint when an earlier item changes the target offset', async () => {
    const fixture = createFixture();
    const scroller = createTargetReplyScroller({
      getTarget: () => fixture.target,
    });

    expect(scroller.scrollToIndex(0, vi.fn())).toBe(true);
    ResizeObserverMock.instances[0].trigger();
    await Promise.resolve();
    expect(fixture.scrollIntoView).toHaveBeenCalledTimes(1);

    fixture.setTargetRect(rect(4300, 4350));
    fixture.virtualItem.style.top = '4240px';
    await Promise.resolve();

    expect(fixture.scrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('uses the current reply element after a virtualized remount', async () => {
    const fixture = createFixture();
    let currentTarget = fixture.target;
    const scroller = createTargetReplyScroller({
      getTarget: () => currentTarget,
    });

    expect(scroller.scrollToIndex(0, vi.fn())).toBe(true);
    ResizeObserverMock.instances[0].trigger();
    await Promise.resolve();
    flushAnimationFrame();
    flushAnimationFrame();

    const remountedTarget = document.createElement('div');
    const remountedScrollIntoView = vi.fn();
    remountedTarget.scrollIntoView = remountedScrollIntoView;
    fixture.target.remove();
    fixture.threadRow.append(remountedTarget);
    currentTarget = remountedTarget;

    ResizeObserverMock.instances[0].trigger();
    await Promise.resolve();
    flushAnimationFrame();
    flushAnimationFrame();

    expect(remountedScrollIntoView).toHaveBeenCalledTimes(2);
  });

  it('disposes pending work without acknowledging the target', () => {
    const fixture = createFixture();
    const onSettled = vi.fn();
    const scroller = createTargetReplyScroller({
      getTarget: () => fixture.target,
    });

    expect(scroller.scrollToIndex(0, onSettled)).toBe(true);
    scroller.dispose();
    flushAnimationFrame();
    vi.runAllTimers();

    fixture.scrollElement.dispatchEvent(new WheelEvent('wheel'));
    ResizeObserverMock.instances[0].trigger();
    flushAnimationFrame();

    expect(fixture.scrollIntoView).not.toHaveBeenCalled();
    expect(onSettled).not.toHaveBeenCalled();
    expect(ResizeObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
  });

  it('waits for a measured scroll surface before releasing the target', async () => {
    const fixture = createFixture();
    // The app opened into a squished viewport: nothing has a box yet, so every
    // "is the target on screen?" comparison passes against 0x0 rects.
    fixture.setScrollRect(rect(0, 0));
    fixture.setTargetRect(rect(0, 0));
    fixture.target.scrollIntoView = vi.fn();

    const onSettled = vi.fn();
    const scroller = createTargetReplyScroller({
      getTarget: () => fixture.target,
    });

    expect(scroller.scrollToIndex(0, onSettled)).toBe(true);
    ResizeObserverMock.instances[0].trigger();
    await Promise.resolve();
    flushAnimationFrame();
    flushAnimationFrame();

    vi.advanceTimersByTime(2000);
    expect(onSettled).not.toHaveBeenCalled();

    // Layout settles and the target lands.
    fixture.setScrollRect(rect(0, 600));
    fixture.setTargetRect(rect(275, 325));
    vi.advanceTimersByTime(200);

    expect(onSettled).toHaveBeenCalledOnce();
  });

  it('keeps the target through a tap and releases it on a drag', () => {
    const fixture = createFixture();
    const onSettled = vi.fn();
    const scroller = createTargetReplyScroller({
      getTarget: () => fixture.target,
    });

    expect(scroller.scrollToIndex(0, onSettled)).toBe(true);
    flushAnimationFrame();

    // A tap — pressing a message, or the stray touch while the channel opens.
    fixture.scrollElement.dispatchEvent(touchEvent('touchstart', 100, 100));
    fixture.scrollElement.dispatchEvent(touchEvent('touchmove', 102, 103));
    fixture.scrollElement.dispatchEvent(touchEvent('touchend', 102, 103));
    expect(onSettled).not.toHaveBeenCalled();

    // A drag hands the scroll back to the user.
    fixture.scrollElement.dispatchEvent(touchEvent('touchstart', 100, 100));
    fixture.scrollElement.dispatchEvent(touchEvent('touchmove', 100, 140));

    expect(onSettled).toHaveBeenCalledOnce();
    expect(ResizeObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
  });

  it('releases navigation when the user starts scrolling', () => {
    const fixture = createFixture();
    const onSettled = vi.fn();
    const scroller = createTargetReplyScroller({
      getTarget: () => fixture.target,
    });

    expect(scroller.scrollToIndex(0, onSettled)).toBe(true);
    flushAnimationFrame();
    fixture.scrollElement.dispatchEvent(new WheelEvent('wheel'));

    expect(onSettled).toHaveBeenCalledOnce();
    expect(ResizeObserverMock.instances[0].disconnect).toHaveBeenCalledOnce();
  });
});
