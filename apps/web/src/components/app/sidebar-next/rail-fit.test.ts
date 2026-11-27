import { describe, expect, it } from 'vitest';
import { railNavFitCount } from './rail-fit';

describe('railNavFitCount', () => {
  it('counts only whole buttons, never one cut short', () => {
    // 16px padding + 9 buttons (360px) + 8 gaps (32px) = 408px.
    expect(railNavFitCount(408)).toBe(9);
    expect(railNavFitCount(407)).toBe(8);
    // The navs a 750px and a 700px window left: no sliver of a 10th or 9th.
    expect(railNavFitCount(432)).toBe(9);
    expect(railNavFitCount(384)).toBe(8);
  });

  it('fits nothing when there is no room', () => {
    expect(railNavFitCount(0)).toBe(0);
    expect(railNavFitCount(55)).toBe(0);
    expect(railNavFitCount(56)).toBe(1);
  });
});
