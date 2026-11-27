import { describe, expect, it } from 'vitest';
import { createSnapPager } from './SnapPager';

// A 1440px desktop window leaves the calendar pager this wide. CSS places
// page N at N times this width, while clientWidth rounds it to 1021.
const WIDTH = 1021.484375;

function fractionalViewport() {
  const viewport = document.createElement('div');
  Object.defineProperty(viewport, 'clientWidth', { value: Math.round(WIDTH) });
  viewport.getBoundingClientRect = () => new DOMRect(0, 0, WIDTH, 800);
  return viewport;
}

describe('SnapPager at a fractional viewport width', () => {
  it('scrolls to the offset where CSS lays out each page', () => {
    const viewport = fractionalViewport();
    const pager = createSnapPager();
    const detach = pager.attachViewport(viewport);
    try {
      expect(viewport.scrollLeft).toBeCloseTo(1000 * WIDTH, 3);
      pager.next();
      expect(pager.position()).toBe(1);
      expect(viewport.scrollLeft).toBeCloseTo(1001 * WIDTH, 3);
      pager.reset();
      expect(viewport.scrollLeft).toBeCloseTo(1000 * WIDTH, 3);
    } finally {
      detach();
    }
  });

  it('reads the page under a native scroll offset', () => {
    const viewport = fractionalViewport();
    const pager = createSnapPager();
    const detach = pager.attachViewport(viewport);
    try {
      viewport.scrollLeft = 1002 * WIDTH;
      viewport.dispatchEvent(new Event('scroll'));
      expect(pager.position()).toBe(2);
      expect(pager.fractionalPosition()).toBeCloseTo(2, 6);
    } finally {
      detach();
    }
  });
});
