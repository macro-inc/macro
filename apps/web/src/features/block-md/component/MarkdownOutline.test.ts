import { describe, expect, it } from 'vitest';
import { getVisibleHeadingIndexes, shouldShowOutline } from './MarkdownOutline';

describe('getVisibleHeadingIndexes', () => {
  it('highlights every section overlapping the viewport', () => {
    expect(getVisibleHeadingIndexes([20, 100, 300, 700], 900, 80, 600)).toEqual(
      [0, 1, 2]
    );
  });

  it('keeps a long section highlighted after its heading scrolls away', () => {
    expect(getVisibleHeadingIndexes([-900, 700, 1000], 1300, 0, 600)).toEqual([
      0,
    ]);
  });

  it('does not select a heading below the viewport', () => {
    expect(getVisibleHeadingIndexes([700, 900, 1200], 1500, 0, 600)).toEqual(
      []
    );
  });

  it('excludes sections that only touch the viewport boundary', () => {
    expect(getVisibleHeadingIndexes([-100, 0, 300, 600], 900, 0, 600)).toEqual([
      1, 2,
    ]);
  });

  it('stops highlighting the last section after the editor ends', () => {
    expect(getVisibleHeadingIndexes([-600, -400, -200], 0, 0, 600)).toEqual([]);
  });

  it('includes the last section while its content is still visible', () => {
    expect(getVisibleHeadingIndexes([-600, -400, -200], 100, 0, 600)).toEqual([
      2,
    ]);
  });

  it('returns no selection without headings or a visible viewport', () => {
    expect(getVisibleHeadingIndexes([], 900, 0, 600)).toEqual([]);
    expect(getVisibleHeadingIndexes([0, 100, 200], 900, 300, 300)).toEqual([]);
  });
});

describe('shouldShowOutline', () => {
  it('requires layout eligibility and at least three headings', () => {
    expect(shouldShowOutline(2, true)).toBe(false);
    expect(shouldShowOutline(3, false)).toBe(false);
    expect(shouldShowOutline(3, true)).toBe(true);
  });
});
