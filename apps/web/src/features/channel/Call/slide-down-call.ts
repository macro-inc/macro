/** Distance the call knob must travel to place the call. 1 CSS inch. */
export const SLIDE_TO_CALL_DISTANCE_PX = 96;

/**
 * Slot overhang past the knob on each end. Keeps the knob looking seated in a
 * recess at both ends of its travel instead of flush with the slot's edge.
 */
export const SLIDE_SLOT_PADDING_PX = 4;

/** Downward movement (px) before the track is treated as revealed mid-drag. */
const TRACK_REVEAL_PX = 4;

export type SlideDownProgress = {
  offset: number;
  revealTrack: boolean;
  armed: boolean;
};

export function isSlideDownArmed(offset: number): boolean {
  return offset >= SLIDE_TO_CALL_DISTANCE_PX;
}

/** How far along the track the thumb sits, as a 0–1 fraction. */
export function slideDownFraction(offset: number): number {
  return clampOffset(offset) / SLIDE_TO_CALL_DISTANCE_PX;
}

export function slideDownProgress(dy: number): SlideDownProgress {
  const offset = clampOffset(dy);
  return {
    offset,
    revealTrack: dy > TRACK_REVEAL_PX,
    armed: isSlideDownArmed(offset),
  };
}

function clampOffset(dy: number): number {
  return Math.min(Math.max(0, dy), SLIDE_TO_CALL_DISTANCE_PX);
}
