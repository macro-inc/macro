import { describe, expect, it } from 'vitest';
import {
  clampSlideOffset,
  isHorizontalSlide,
  isSlideDownArmed,
  SLIDE_TO_CALL_DISTANCE_PX,
  slideDownFraction,
} from '../slide-down-call';

describe('clampSlideOffset', () => {
  it('ignores upward movement', () => {
    expect(clampSlideOffset(-20)).toBe(0);
    expect(clampSlideOffset(0)).toBe(0);
  });

  it('tracks downward movement one to one', () => {
    expect(clampSlideOffset(12)).toBe(12);
    expect(clampSlideOffset(SLIDE_TO_CALL_DISTANCE_PX)).toBe(
      SLIDE_TO_CALL_DISTANCE_PX
    );
  });

  it('clamps overshoot to the end of the track', () => {
    expect(clampSlideOffset(SLIDE_TO_CALL_DISTANCE_PX + 40)).toBe(
      SLIDE_TO_CALL_DISTANCE_PX
    );
  });
});

describe('isSlideDownArmed', () => {
  it('is false until the knob reaches the inch mark', () => {
    expect(isSlideDownArmed(0)).toBe(false);
    expect(isSlideDownArmed(SLIDE_TO_CALL_DISTANCE_PX - 1)).toBe(false);
    expect(isSlideDownArmed(SLIDE_TO_CALL_DISTANCE_PX)).toBe(true);
  });
});

describe('slideDownFraction', () => {
  it('reports travel as a clamped 0-1 fraction', () => {
    expect(slideDownFraction(-10)).toBe(0);
    expect(slideDownFraction(0)).toBe(0);
    expect(slideDownFraction(SLIDE_TO_CALL_DISTANCE_PX / 2)).toBe(0.5);
    expect(slideDownFraction(SLIDE_TO_CALL_DISTANCE_PX)).toBe(1);
    expect(slideDownFraction(SLIDE_TO_CALL_DISTANCE_PX * 3)).toBe(1);
  });
});

describe('isHorizontalSlide', () => {
  it('ignores small sideways jitter during a downward slide', () => {
    expect(isHorizontalSlide(0, 40)).toBe(false);
    expect(isHorizontalSlide(8, 40)).toBe(false);
    expect(isHorizontalSlide(-8, 4)).toBe(false);
  });

  it('hands a mostly sideways swipe back to the panel', () => {
    expect(isHorizontalSlide(60, 20)).toBe(true);
    expect(isHorizontalSlide(-60, 20)).toBe(true);
  });

  it('keeps the slide when downward travel dominates', () => {
    expect(isHorizontalSlide(30, 90)).toBe(false);
  });
});
