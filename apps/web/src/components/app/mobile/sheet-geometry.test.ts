import { describe, expect, it } from 'vitest';
import {
  nearestSnapPoint,
  sheetHiddenSize,
  sheetOffset,
  sheetSnapPoints,
} from './sheet-geometry';

describe('sheet geometry', () => {
  const bottom = { panelSize: 400, maxOffset: 408 };

  it('keeps open points and always ends fully open', () => {
    expect(sheetSnapPoints(undefined)).toEqual([1]);
    expect(sheetSnapPoints([0, 1, 0.5, 0.5])).toEqual([0.5, 1]);
  });

  it('opens at the end of its scroll range', () => {
    expect(sheetOffset(bottom, 0)).toBe(0);
    expect(sheetOffset(bottom, 0.5)).toBe(200);
    // Fully open includes the gutter below the panel.
    expect(sheetOffset(bottom, 1)).toBe(408);
  });

  it('settles on the nearest point, closed included', () => {
    const points = sheetSnapPoints([0.5]);
    expect(nearestSnapPoint(bottom, 30, points)).toBe(0);
    expect(nearestSnapPoint(bottom, 230, points)).toBe(0.5);
    expect(nearestSnapPoint(bottom, 390, points)).toBe(1);
  });

  it('measures how much of a resting sheet is off screen', () => {
    expect(sheetHiddenSize(bottom, 200)).toBe(208);
    expect(sheetHiddenSize(bottom, 408)).toBe(0);
  });
});
