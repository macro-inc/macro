import { scrollIntoViewport } from '@kobalte/utils';
import { expect, it, vi } from 'vitest';

it('advances through nested scroll parents when the document cannot scroll', () => {
  // Regression for the patched helper used when opening a menu by keyboard.
  const overflow = document.documentElement.style.overflow;
  const outer = document.createElement('div');
  const inner = document.createElement('div');
  const trigger = document.createElement('button');
  outer.style.overflow = 'auto';
  inner.style.overflow = 'auto';
  inner.append(trigger);
  outer.append(inner);
  document.body.append(outer);
  document.documentElement.style.overflow = 'hidden';
  const outerScroll = vi.fn();
  const innerScroll = vi.fn();
  Object.defineProperty(outer, 'scrollTop', { get: () => 0, set: outerScroll });
  Object.defineProperty(inner, 'scrollTop', { get: () => 0, set: innerScroll });
  const getStyle = window.getComputedStyle.bind(window);
  let visits = 0;
  const style = vi
    .spyOn(window, 'getComputedStyle')
    .mockImplementation((node) => {
      // Fail promptly instead of hanging the test process if the loop returns.
      if (++visits > 20)
        throw new Error('Scroll-parent traversal did not advance');
      return getStyle(node);
    });
  try {
    scrollIntoViewport(trigger);
    expect(innerScroll).toHaveBeenCalledOnce();
    expect(outerScroll).toHaveBeenCalledOnce();
  } finally {
    style.mockRestore();
    document.documentElement.style.overflow = overflow;
    outer.remove();
  }
});
