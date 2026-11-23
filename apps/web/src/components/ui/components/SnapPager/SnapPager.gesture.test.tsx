import { createEffect, createRoot } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapPager } from './SnapPager';

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
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
  pager.attachViewport(element);
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

  it('releases a tap with no scroll and no native scrollend', () => {
    const { pager, element } = measuredPager();
    element.dispatchEvent(new Event('touchstart'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
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
