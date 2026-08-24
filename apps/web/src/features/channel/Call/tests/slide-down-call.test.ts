import { describe, expect, it } from 'vitest';
import {
  isSlideDownArmed,
  SLIDE_TO_CALL_DISTANCE_PX,
  slideDownFraction,
  slideDownProgress,
} from '../slide-down-call';

describe('slideDownProgress', () => {
  it('clamps upward movement to rest', () => {
    expect(slideDownProgress(-20)).toEqual({
      offset: 0,
      revealTrack: false,
      armed: false,
    });
  });

  it('does not reveal the track for a tap or tiny nudge', () => {
    expect(slideDownProgress(0).revealTrack).toBe(false);
    expect(slideDownProgress(4).revealTrack).toBe(false);
  });

  it('reveals the track after a short downward drag', () => {
    expect(slideDownProgress(12)).toEqual({
      offset: 12,
      revealTrack: true,
      armed: false,
    });
  });

  it('arms the call after dragging about an inch', () => {
    expect(slideDownProgress(SLIDE_TO_CALL_DISTANCE_PX)).toEqual({
      offset: SLIDE_TO_CALL_DISTANCE_PX,
      revealTrack: true,
      armed: true,
    });
    expect(slideDownProgress(SLIDE_TO_CALL_DISTANCE_PX + 40).offset).toBe(
      SLIDE_TO_CALL_DISTANCE_PX
    );
  });
});

describe('isSlideDownArmed', () => {
  it('is false until the thumb reaches the inch mark', () => {
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
