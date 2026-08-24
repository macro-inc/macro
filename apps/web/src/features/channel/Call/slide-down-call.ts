/** Distance the call thumb must travel to place the call. 1 CSS inch. */
export const SLIDE_TO_CALL_DISTANCE_PX = 96;

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

export function slideDownProgress(dy: number): SlideDownProgress {
  const offset = Math.min(Math.max(0, dy), SLIDE_TO_CALL_DISTANCE_PX);
  return {
    offset,
    revealTrack: dy > TRACK_REVEAL_PX,
    armed: isSlideDownArmed(offset),
  };
}
