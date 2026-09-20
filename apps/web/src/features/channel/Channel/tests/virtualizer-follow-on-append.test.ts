import { Virtualizer } from '@tanstack/solid-virtual';
import { expect, it, vi } from 'vitest';

it('does not follow empty-to-empty updates but follows the first append', () => {
  const element = document.createElement('div');
  document.body.append(element);
  const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
    count: 0,
    getScrollElement: () => element,
    estimateSize: () => 100,
    anchorTo: 'end',
    followOnAppend: true,
    scrollToFn: vi.fn(),
    observeElementRect: (_instance, callback) => {
      callback({ width: 375, height: 500 });
    },
    observeElementOffset: (_instance, callback) => {
      callback(0, false);
    },
  });
  const cleanup = virtualizer._didMount();
  const scrollToEnd = vi.spyOn(virtualizer, 'scrollToEnd');
  try {
    virtualizer._willUpdate();
    expect(virtualizer.isAtEnd()).toBe(true);
    const getItemKey = vi.fn((index: number) => String(index));
    virtualizer.setOptions({ ...virtualizer.options, count: 0, getItemKey });
    virtualizer._willUpdate();
    expect(scrollToEnd).not.toHaveBeenCalled();
    expect(getItemKey).not.toHaveBeenCalled();

    virtualizer.setOptions({ ...virtualizer.options, count: 1 });
    virtualizer._willUpdate();
    expect(scrollToEnd).toHaveBeenCalledExactlyOnceWith({ behavior: 'auto' });
  } finally {
    scrollToEnd.mockRestore();
    cleanup();
    element.remove();
  }
});

it.each([true, false])(
  'preserves the correct anchor when delayed activity is inserted between messages (pinned=%s)',
  (pinned) => {
    const element = document.createElement('div');
    document.body.append(element);
    let keys = Array.from({ length: 20 }, (_, index) => `message-${index}`);
    let domHeight = 2000;
    Object.defineProperties(element, {
      clientHeight: { value: 500 },
      scrollHeight: { get: () => domHeight },
    });
    const virtualizer = new Virtualizer<HTMLDivElement, HTMLDivElement>({
      count: keys.length,
      getItemKey: (index) => keys[index],
      getScrollElement: () => element,
      estimateSize: (index) => (keys[index] === 'activity' ? 36 : 100),
      anchorTo: 'end',
      followOnAppend: true,
      scrollEndThreshold: 1,
      scrollToFn: vi.fn(),
      observeElementRect: (_instance, callback) => {
        callback({ width: 375, height: 500 });
      },
      observeElementOffset: (_instance, callback) => {
        callback(pinned ? 1500 : 700, false);
      },
    });
    const cleanup = virtualizer._didMount();
    const scrollToEnd = vi.spyOn(virtualizer, 'scrollToEnd');
    try {
      virtualizer._willUpdate();
      expect(virtualizer.isAtEnd()).toBe(pinned);
      const oldKeys = keys;
      keys = [...oldKeys.slice(0, 19), 'activity', oldKeys[19]];
      virtualizer.setOptions({
        ...virtualizer.options,
        count: keys.length,
        getItemKey: (index) => keys[index],
      });
      domHeight = 2036;
      virtualizer._willUpdate();
      expect(virtualizer.getTotalSize()).toBe(2036);
      if (pinned) {
        expect(scrollToEnd).toHaveBeenCalledExactlyOnceWith({
          behavior: 'auto',
        });
      } else {
        expect(scrollToEnd).not.toHaveBeenCalled();
        expect(virtualizer.scrollOffset).toBe(700);
      }
    } finally {
      scrollToEnd.mockRestore();
      cleanup();
      element.remove();
    }
  }
);
