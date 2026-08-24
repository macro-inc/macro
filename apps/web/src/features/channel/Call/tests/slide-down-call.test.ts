import { describe, expect, it } from 'vitest';
import {
  isSlideDownArmed,
  SLIDE_TO_CALL_DISTANCE_PX,
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
