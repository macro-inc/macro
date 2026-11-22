import { cleanup, render } from '@solidjs/testing-library';
import { For } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSnapPager, SnapPager } from './index';

function viewport() {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', {
    value: 100,
    configurable: true,
  });
  element.scrollTo = vi.fn(
    (options?: ScrollToOptions | number, _y?: number) => {
      if (typeof options === 'object')
        element.scrollLeft = options.left ?? element.scrollLeft;
    }
  );
  return element;
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('SnapPager', () => {
  it('rotates only recycled slots and keeps stable descriptors', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const pages = pager.pages();
    const element = viewport();
    pager.attachViewport(element);
    element.scrollLeft = 300;
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.pages()).toBe(pages);
    expect(pager.pageOrder()).toEqual([1, 2, 3, 4, 0]);
    expect(pages.map((page) => page.position())).toEqual([5, 1, 2, 3, 4]);
    expect(pages.map((page) => page.offset())).toEqual([2, -2, -1, 0, 1]);
    expect(pager.activePage()).toBe(3);
    expect(pager.position()).toBe(1);
    expect(element.scrollLeft).toBe(200);
    expect(moved).toHaveBeenCalledWith(1);
    element.scrollLeft = 100;
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(0);
    expect(pager.pageOrder()).toEqual([0, 1, 2, 3, 4]);
    expect(moved).toHaveBeenLastCalledWith(-1);
  });

  it('settles with the debounce fallback and cancels it on scrollend', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const element = viewport();
    pager.attachViewport(element);
    element.scrollLeft = 300;
    element.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(60);
    expect(moved).not.toHaveBeenCalled();
    element.dispatchEvent(new Event('scroll'));
    vi.advanceTimersByTime(99);
    expect(moved).not.toHaveBeenCalled();
    element.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(100);
    expect(moved).toHaveBeenCalledTimes(1);
  });

  it('clamps the settled page and jumps instantly beyond the ring', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ pageCount: 3, onSettle: moved });
    const element = viewport();
    pager.attachViewport(element);
    element.scrollLeft = 1000;
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(1);
    pager.goTo(12);
    expect(pager.position()).toBe(13);
    expect(moved).toHaveBeenLastCalledWith(12);
    expect(element.scrollLeft).toBe(100);
    expect(pager.pages().map((page) => page.position())).toEqual([3, 1, 2]);
    expect(() => createSnapPager({ pageCount: 4 })).toThrow(RangeError);
    expect(() => createSnapPager({ pageCount: 1 })).toThrow(RangeError);
  });

  it.each([1, 2, 5, 12])(
    'counts all %i rapid next presses without queuing intermediate pages',
    (count) => {
      const moved = vi.fn();
      const pager = createSnapPager({ onSettle: moved });
      const element = viewport();
      pager.attachViewport(element);
      for (let index = 0; index < count; index++) pager.next();
      element.dispatchEvent(new Event('scrollend'));
      vi.advanceTimersByTime(250);
      expect(pager.position()).toBe(count);
      expect(moved).toHaveBeenCalledExactlyOnceWith(count);
      expect(element.scrollLeft).toBe(200);
    }
  );

  it('accumulates mixed next, previous, and relative goTo commands', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const element = viewport();
    pager.attachViewport(element);
    pager.next();
    pager.goTo(3);
    pager.previous();
    pager.goTo(-5);
    expect(pager.position()).toBe(-2);
    vi.advanceTimersByTime(250);
    expect(moved).toHaveBeenCalledExactlyOnceWith(-2);
  });

  it('retargets fast presses immediately and reports only the quiet final target', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const element = viewport();
    pager.attachViewport(element);
    pager.next();
    expect(element.scrollTo).toHaveBeenLastCalledWith({
      left: 300,
      behavior: 'smooth',
    });
    vi.advanceTimersByTime(40);
    pager.next();
    expect(pager.position()).toBe(2);
    expect(element.scrollLeft).toBe(200);
    element.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(40);
    pager.next();
    expect(pager.position()).toBe(3);
    expect(moved).not.toHaveBeenCalled();
    vi.advanceTimersByTime(250);
    expect(moved).toHaveBeenCalledExactlyOnceWith(3);
  });

  it('locks horizontal commands and preserves the current location', () => {
    const pager = createSnapPager();
    const element = viewport();
    pager.attachViewport(element);
    element.scrollLeft = 300;
    pager.setLocked(true);
    pager.next();
    pager.goTo(10);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(0);
    expect(element.scrollLeft).toBe(300);
    pager.setLocked(false);
    expect(pager.position()).toBe(1);
  });

  it('cancels a pending slide when locking then unlocking at center', () => {
    const canceled = vi.fn();
    const moved = vi.fn();
    const pager = createSnapPager({
      onNavigationCancel: canceled,
      onSettle: moved,
    });
    const element = viewport();
    pager.attachViewport(element);
    pager.next();
    pager.setLocked(true);
    element.scrollLeft = 200;
    pager.setLocked(false);
    expect(pager.position()).toBe(0);
    expect(canceled).toHaveBeenCalledOnce();
    expect(moved).not.toHaveBeenCalled();
  });

  it('detaches listeners and pending fallback', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const element = viewport();
    const detach = pager.attachViewport(element);
    element.scrollLeft = 300;
    element.dispatchEvent(new Event('scroll'));
    detach();
    vi.advanceTimersByTime(200);
    element.dispatchEvent(new Event('scrollend'));
    expect(moved).not.toHaveBeenCalled();
    expect(pager.viewport()).toBeUndefined();
  });

  it('uses instant scrolling for reduced motion and resets', () => {
    vi.stubGlobal(
      'matchMedia',
      vi.fn(() => ({ matches: true }))
    );
    const pager = createSnapPager();
    const element = viewport();
    pager.attachViewport(element);
    pager.next();
    expect(element.scrollTo).toHaveBeenLastCalledWith({
      left: 300,
      behavior: 'instant',
    });
    vi.runOnlyPendingTimers();
    expect(pager.position()).toBe(1);
    pager.reset();
    expect(pager.position()).toBe(0);
    expect(pager.pageOrder()).toEqual([0, 1, 2, 3, 4]);
  });

  it('keeps keyed page nodes mounted and releases the viewport observer', () => {
    const pager = createSnapPager();
    const disconnect = vi.fn();
    const observe = vi.fn();
    vi.stubGlobal(
      'ResizeObserver',
      class {
        observe = observe;
        disconnect = disconnect;
      }
    );
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1)
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    HTMLDivElement.prototype.scrollTo = vi.fn();
    const { container } = render(() => (
      <SnapPager.Root controller={pager}>
        <SnapPager.Viewport>
          <For each={pager.pages()}>
            {(page) => <SnapPager.Page page={page}>{page.key}</SnapPager.Page>}
          </For>
        </SnapPager.Viewport>
      </SnapPager.Root>
    ));
    const nodes = Array.from(container.querySelectorAll('.snap-pager-page'));
    expect(nodes).toHaveLength(5);
    expect(
      nodes.filter((node) => node.getAttribute('aria-hidden') === 'false')
    ).toHaveLength(1);
    pager.goTo(10);
    expect(Array.from(container.querySelectorAll('.snap-pager-page'))).toEqual(
      nodes
    );
    expect(observe).toHaveBeenCalledTimes(1);
    cleanup();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(pager.viewport()).toBeUndefined();
    Reflect.deleteProperty(HTMLDivElement.prototype, 'scrollTo');
  });

  it('does not recycle pages while a touch remains held after scrollend or debounce', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const element = viewport();
    pager.attachViewport(element);
    element.dispatchEvent(new Event('touchstart'));
    element.scrollLeft = 300;
    element.dispatchEvent(new Event('scroll'));
    element.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(200);
    expect(pager.position()).toBe(0);
    expect(moved).not.toHaveBeenCalled();
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    vi.advanceTimersByTime(180);
    expect(pager.position()).toBe(1);
    expect(moved).toHaveBeenCalledExactlyOnceWith(1);
  });

  it('settles the opposite command after a canceled smooth scroll', () => {
    const pager = createSnapPager();
    const element = viewport();
    pager.attachViewport(element);
    pager.next();
    element.scrollLeft = 250;
    pager.previous();
    expect(element.scrollTo).toHaveBeenLastCalledWith({
      left: 200,
      behavior: 'instant',
    });
    element.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(180);
    expect(pager.position()).toBe(0);
    expect(element.scrollLeft).toBe(200);
    expect(pager.phase()).toBe('idle');
  });

  it('defers a far jump until the fling settles', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const element = viewport();
    pager.attachViewport(element);
    element.scrollLeft = 300;
    element.dispatchEvent(new Event('scroll'));
    pager.goTo(12);
    expect(pager.position()).toBe(0);
    expect(element.scrollLeft).toBe(300);
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(12);
    expect(element.scrollLeft).toBe(200);
    expect(moved.mock.calls).toEqual([[12]]);
  });

  it('keeps the active page centered when resizing a locked viewport', () => {
    const pager = createSnapPager();
    const element = viewport();
    pager.attachViewport(element);
    pager.setLocked(true);
    Object.defineProperty(element, 'clientWidth', { value: 200 });
    pager.resize();
    expect(element.scrollLeft).toBe(400);
    pager.setLocked(false);
    expect(pager.position()).toBe(0);
    expect(element.scrollLeft).toBe(400);
  });

  it('keeps a later held swipe from being reversed by an earlier date request', () => {
    const moved = vi.fn();
    const canceled = vi.fn();
    const pager = createSnapPager({
      onSettle: moved,
      onNavigationCancel: canceled,
    });
    const element = viewport();
    pager.attachViewport(element);
    element.dispatchEvent(new Event('touchstart'));
    element.scrollLeft = 300;
    element.dispatchEvent(new Event('scroll'));
    pager.goTo(1);
    element.scrollLeft = 400;
    element.dispatchEvent(new Event('scroll'));
    window.dispatchEvent(new TouchEvent('touchend', { touches: [] }));
    element.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(2);
    expect(moved).toHaveBeenCalledExactlyOnceWith(2);
    expect(canceled).toHaveBeenCalledOnce();
  });

  it('does not let a stale viewport release or settle the replacement', () => {
    const moved = vi.fn();
    const pager = createSnapPager({ onSettle: moved });
    const stale = viewport();
    const detachStale = pager.attachViewport(stale);
    stale.dispatchEvent(new Event('touchstart'));
    stale.scrollLeft = 300;
    stale.dispatchEvent(new Event('scroll'));
    const current = viewport();
    pager.attachViewport(current);
    detachStale();
    stale.dispatchEvent(new Event('scrollend'));
    vi.advanceTimersByTime(200);
    expect(pager.viewport()).toBe(current);
    expect(pager.position()).toBe(0);
    expect(moved).not.toHaveBeenCalled();
    current.scrollLeft = 300;
    current.dispatchEvent(new Event('scrollend'));
    expect(pager.position()).toBe(1);
  });
});
