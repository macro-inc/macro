import { describe, expect, it } from 'vitest';
import { FIT_TO_WIDTH_ZOOM_FLOOR, fitToWidthZoom } from './fitToWidthZoom';

describe('fitToWidthZoom', () => {
  it('does not zoom when content fits', () => {
    expect(
      fitToWidthZoom({ containerWidth: 800, contentWidth: 600 })
    ).toBeUndefined();
  });

  it('does not zoom when sizes are equal', () => {
    expect(
      fitToWidthZoom({ containerWidth: 800, contentWidth: 800 })
    ).toBeUndefined();
  });

  it('ignores a zero-width container', () => {
    expect(
      fitToWidthZoom({ containerWidth: 0, contentWidth: 1200 })
    ).toBeUndefined();
  });

  it('uses the raw ratio for a mild newsletter overflow', () => {
    expect(fitToWidthZoom({ containerWidth: 800, contentWidth: 836 })).toEqual({
      zoom: 800 / 836,
      overflowsAfterZoom: false,
    });
  });

  it('floors pathological width instead of shrinking to dust', () => {
    const result = fitToWidthZoom({
      containerWidth: 800,
      contentWidth: 4000,
    });
    expect(result?.zoom).toBe(FIT_TO_WIDTH_ZOOM_FLOOR);
    expect(result?.overflowsAfterZoom).toBe(true);
  });
});
