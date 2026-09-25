import { describe, expect, it } from 'vitest';
import { placeGuide } from './guidePlacement';

describe('guide placement', () => {
  const bounds = { left: 80, top: 0, width: 1360, height: 900 };
  it('puts the Home tour to the right of its list', () => {
    expect(
      placeGuide(
        bounds,
        { left: 80, top: 80, width: 300, height: 800 },
        320,
        400
      )
    ).toEqual({ left: 396, top: 80 });
  });
  it('flips left for a control near the right edge', () => {
    expect(
      placeGuide(
        bounds,
        { left: 1200, top: 100, width: 120, height: 40 },
        320,
        400
      )
    ).toEqual({ left: 864, top: 100 });
  });
  it('keeps a flyover inside a small split and short viewport', () => {
    const position = placeGuide(
      { left: 700, top: 60, width: 420, height: 540 },
      { left: 710, top: 540, width: 300, height: 40 },
      320,
      400
    );
    expect(position.left).toBeGreaterThanOrEqual(716);
    expect(position.left + 320).toBeLessThanOrEqual(1104);
    expect(position.top).toBeGreaterThanOrEqual(76);
    expect(position.top + 400).toBeLessThanOrEqual(584);
  });
  it('provides a right-side fallback when a control is unavailable', () => {
    expect(placeGuide(bounds, undefined, 320, 400)).toEqual({
      left: 1104,
      top: 88,
    });
  });
});
