import { Virtualizer } from '@tanstack/solid-virtual';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

beforeEach(() => {
  vi.spyOn(navigator, 'userAgent', 'get').mockReturnValue('iPhone');
});
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
});

function setup(useIOSScrollDeferral?: boolean) {
  const element = document.createElement('div');
  document.body.append(element);
  let observeOffset: (offset: number, scrolling: boolean) => void = () => {};
  const scrollToFn = vi.fn();
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 100,
    getItemKey: (index) => String(index),
    getScrollElement: () => element,
    estimateSize: () => 100,
    initialOffset: 1000,
    anchorTo: 'end',
    useIOSScrollDeferral,
    scrollToFn,
    observeElementRect: (_instance, callback) => {
      callback({ width: 375, height: 500 });
    },
    observeElementOffset: (_instance, callback) => {
      observeOffset = callback;
      callback(1000, false);
    },
  });
  const cleanup = virtualizer._didMount();
  virtualizer._willUpdate();
  observeOffset(1000, true);
  scrollToFn.mockClear();
  return { virtualizer, scrollToFn, cleanup };
}

describe('channel-owned iOS scroll compensation', () => {
  it.each([undefined, false])(
    'delegates resize corrections only when core deferral is disabled (%s)',
    (useIOSScrollDeferral) => {
      const f = setup(useIOSScrollDeferral);
      try {
        f.virtualizer.resizeItem(0, 180);
        if (useIOSScrollDeferral === false) {
          expect(f.scrollToFn).toHaveBeenCalledWith(
            1000,
            expect.objectContaining({ adjustments: 80 }),
            f.virtualizer
          );
          expect(f.virtualizer.scrollOffset).toBe(1080);
        } else {
          expect(f.scrollToFn).not.toHaveBeenCalled();
        }
      } finally {
        f.cleanup();
      }
    }
  );

  it.each([undefined, false])(
    'delegates prepend corrections only when core deferral is disabled (%s)',
    (useIOSScrollDeferral) => {
      const f = setup(useIOSScrollDeferral);
      try {
        f.virtualizer.setOptions({
          ...f.virtualizer.options,
          count: 110,
          getItemKey: (index) => String(index - 10),
        });
        f.virtualizer._willUpdate();
        if (useIOSScrollDeferral === false) {
          expect(f.scrollToFn).toHaveBeenCalledWith(
            2000,
            expect.objectContaining({ adjustments: undefined }),
            f.virtualizer
          );
        } else {
          expect(f.scrollToFn).not.toHaveBeenCalled();
        }
      } finally {
        f.cleanup();
      }
    }
  );
});
