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
