import { describe, expect, it } from 'vitest';
import { railNavFitCount, railNavRoom } from './rail-fit';

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

  it('fits more of the small dock’s 32px buttons in the same room', () => {
    // 16px padding + 11 buttons (352px) + 10 gaps (40px) = 408px.
    expect(railNavFitCount(408, 32)).toBe(11);
    expect(railNavFitCount(407, 32)).toBe(10);
  });

  it('needs no leading space when the apps are centered', () => {
    // 9 buttons (360px) + 8 gaps (32px) = 392px.
    expect(railNavFitCount(392, 40, 0)).toBe(9);
    expect(railNavFitCount(391, 40, 0)).toBe(8);
  });
});

describe('railNavRoom', () => {
  const lengths = { inner: 1000, start: 84, end: 132, more: 40 };

  it('leaves the nav what the start, end and More groups and their gaps do not use', () => {
    // 1000 - 84 - 132 - 40 - 4 gaps (16px).
    expect(railNavRoom(lengths, false)).toBe(728);
  });

  it('centers the apps between two tracks as long as the longer side group', () => {
    // 1000 - 2 × 132 - 40 - 3 gaps (12px).
    expect(railNavRoom(lengths, true)).toBe(684);
  });
});
