import { createEffect, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapPager } from './SnapPager';

const detachViewports: (() => void)[] = [];
beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  for (const detach of detachViewports.splice(0)) detach();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

function measuredPager() {
  const timeline: { at: number; event: string; left: number }[] = [];
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 100 });
  Object.defineProperty(element, 'onscrollend', { value: null });
  element.scrollTo = vi.fn((options?: ScrollToOptions | number) => {
    if (typeof options !== 'object') return;
    timeline.push({
      at: Date.now(),
      event: `scrollTo:${options.behavior}`,
      left: options.left ?? 0,
    });
    // Smooth scrolling finishes only when the fixture emits the final scrollend.
    if (options.behavior === 'instant') element.scrollLeft = options.left ?? 0;
  });
  const pager = createSnapPager({
    onSettle: () =>
      timeline.push({
        at: Date.now(),
        event: 'commit',
        left: element.scrollLeft,
      }),
  });
  detachViewports.push(pager.attachViewport(element));
  timeline.length = 0;
  const scroll = (left: number) => {
    element.scrollLeft = left;
    timeline.push({ at: Date.now(), event: 'scroll', left });
    element.dispatchEvent(new Event('scroll'));
  };
  return { pager, element, scroll, timeline };
}

describe('native gesture settlement', () => {
  it.each(['swipe', 'trackpad'])(
    'keeps %s momentum free of rotation until scrollend',
    (input) => {
      vi.setSystemTime(0);
      const { pager, element, scroll, timeline } = measuredPager();
      if (input === 'swipe') element.dispatchEvent(new Event('touchstart'));
      else element.dispatchEvent(new WheelEvent('wheel', { deltaX: 60 }));
      vi.advanceTimersByTime(20);
      scroll(260);
      if (input === 'swipe')
        window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
      vi.advanceTimersByTime(240);
      scroll(280);
      vi.advanceTimersByTime(240);
      console.info(JSON.stringify({ input, timeline }));
      expect(timeline.filter((entry) => entry.event === 'commit')).toHaveLength(
        0
      );
      expect(pager.position()).toBe(0);
      element.dispatchEvent(new Event('scrollend'));
      expect(element.scrollTo).toHaveBeenLastCalledWith({
        left: 300,
        behavior: 'smooth',
      });
      expect(pager.position()).toBe(0);
      vi.advanceTimersByTime(120);
      scroll(300);
      element.dispatchEvent(new Event('scrollend'));
      expect(pager.position()).toBe(1);
      console.info(JSON.stringify({ input, completedTimeline: timeline }));
    }
  );

  it('smoothly returns a short drag instead of declaring an off-grid position settled', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    vi.advanceTimersByTime(200);
    scroll(240);
    vi.advanceTimersByTime(200);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    element.dispatchEvent(new Event('scrollend'));
    expect(element.scrollTo).toHaveBeenLastCalledWith({
      left: 200,
      behavior: 'smooth',
    });
    expect(pager.position()).toBe(0);
  });

  it('ignores unrelated contact releases outside the viewport', () => {
    const { pager } = measuredPager();
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    expect(pager.phase()).toBe('idle');
    vi.advanceTimersByTime(150);
    expect(pager.phase()).toBe('idle');
  });

  it('captures pointer cancellation consumed by a child', () => {
    const { pager, element } = measuredPager();
    const child = document.createElement('div');
    element.append(child);
    document.body.append(element);
    child.addEventListener('pointercancel', (event) => event.stopPropagation());
    try {
      child.dispatchEvent(
        Object.assign(new Event('pointerdown', { bubbles: true }), {
          pointerType: 'pen',
        })
      );
      child.dispatchEvent(
        Object.assign(new Event('pointercancel', { bubbles: true }), {
          pointerType: 'pen',
        })
      );
      vi.advanceTimersByTime(150);
      expect(pager.phase()).toBe('idle');
      pager.goTo(12);
      expect(pager.position()).toBe(12);
    } finally {
      element.remove();
    }
  });
  it('recovers a no-scroll tap after 150ms', () => {
    const { pager, element } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(149);
    expect(pager.phase()).toBe('scrolling');
    vi.advanceTimersByTime(1);
    expect(pager.phase()).toBe('idle');
  });

  it('lets a new gesture replace an unfinished alignment', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new WheelEvent('wheel', { deltaX: 60 }));
    scroll(260);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(0);
    element.dispatchEvent(new WheelEvent('wheel', { deltaX: -40 }));
    scroll(200);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(0);
    expect(pager.phase()).toBe('idle');
  });
  it('keeps rapid commands queued through a post-release momentum pause', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    scroll(300);
    pager.next();
    pager.next();
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(500);
    expect(pager.position()).toBe(0);
    expect(element.scrollLeft).toBe(300);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(2);
  });

  it('does not run a queued jump before the first asynchronous scroll event', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    pager.goTo(12);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(100);
    expect(pager.position()).toBe(0);
    scroll(300);
    vi.advanceTimersByTime(500);
    expect(pager.position()).toBe(0);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(12);
  });

  it('does not recover when scrollLeft changes without a delivered event', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    pager.goTo(12);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    element.scrollLeft = 300;
    vi.advanceTimersByTime(150);
    expect(pager.position()).toBe(0);
    scroll(300);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(12);
  });

  it('recovers queued navigation when no scroll event or position change arrives', () => {
    const { pager, element } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    pager.goTo(12);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(149);
    expect(pager.position()).toBe(0);
    vi.advanceTimersByTime(1);
    expect(pager.position()).toBe(12);
    expect(pager.phase()).toBe('idle');
  });

  it('restores native ownership if scrolling arrives after no-scroll recovery', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    pager.goTo(12);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(150);
    expect(pager.position()).toBe(12);
    scroll(250);
    pager.next();
    vi.advanceTimersByTime(500);
    expect(pager.position()).toBe(12);
    scroll(300);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(13);
  });

  it('rejects recovery when the position moves away and back during the window', () => {
    const { pager, element } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    pager.goTo(12);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    element.scrollLeft = 220;
    vi.advanceTimersToNextFrame();
    element.scrollLeft = 200;
    vi.advanceTimersByTime(150);
    expect(pager.position()).toBe(0);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(12);
  });

  it('restores native ownership after a recovery even if a command intervenes', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(150);
    pager.next();
    scroll(250);
    pager.next();
    pager.next();
    vi.advanceTimersByTime(500);
    expect(pager.position()).toBe(0);
    scroll(300);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(2);
  });

  it('does not treat pre-release compositor movement as a no-op', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    pager.goTo(12);
    element.scrollLeft = 300;
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(150);
    expect(pager.position()).toBe(0);
    scroll(300);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(12);
  });

  it('cancels recovery on scrollend before a later command starts', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    element.dispatchEvent(new Event('scrollend'));
    pager.next();
    vi.advanceTimersByTime(150);
    expect(pager.position()).toBe(0);
    scroll(300);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(1);
  });

  it('remembers scrollend while held and settles on release without another scroll', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    scroll(300);
    element.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(500);
    expect(pager.position()).toBe(0);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    expect(pager.position()).toBe(1);
    expect(pager.phase()).toBe('idle');
  });

  it('invalidates a held scrollend when the gesture moves again', () => {
    const { pager, element, scroll } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    scroll(260);
    element.dispatchEvent(new Event('scrollend'));
    scroll(280);
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(500);
    expect(pager.position()).toBe(0);
    expect(element.scrollTo).not.toHaveBeenLastCalledWith({
      left: 300,
      behavior: 'smooth',
    });
    element.dispatchEvent(new Event('scrollend'));
    expect(element.scrollTo).toHaveBeenLastCalledWith({
      left: 300,
      behavior: 'smooth',
    });
  });
  it('does not publish reactive page changes during a native gesture', () => {
    const { pager, element, scroll } = measuredPager();
    let changes = 0;
    const dispose = createRoot((dispose) => {
      createEffect(() => {
        pager.position();
        pager.pageOrder();
        changes++;
      });
      return dispose;
    });
    const before = changes;
    element.dispatchEvent(new WheelEvent('wheel', { deltaX: 60 }));
    scroll(275);
    vi.advanceTimersByTime(500);
    expect(changes).toBe(before);
    dispose();
  });
});
