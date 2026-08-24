/** Distance the call knob must travel to place the call. 1 CSS inch. */
export const SLIDE_TO_CALL_DISTANCE_PX = 96;

/**
 * Slot overhang past the knob at the end of its travel, so the knob still
 * looks seated in a recess once it has landed.
 */
export const SLIDE_SLOT_PADDING_PX = 4;

/** Diameter of the knob. Tied to the button's `icon-md` size. */
export const SLIDE_KNOB_SIZE_PX = 36;

/** How quickly the slot opens under the knob once it is grabbed. */
export const SLIDE_REVEAL_MS = 120;

/** How long the knob and slot take to settle back after the finger lifts. */
export const SLIDE_RETURN_MS = 200;

/**
 * Sideways travel (px) that hands the gesture back to the surrounding UI. The
 * channel panel owns horizontal swipes for split navigation, so a swipe that
 * is mostly sideways must not place a call.
 */
const HORIZONTAL_CANCEL_PX = 12;

/** Downward pointer travel converted into knob travel. */
export function clampSlideOffset(dy: number): number {
  return Math.min(Math.max(0, dy), SLIDE_TO_CALL_DISTANCE_PX);
}

export function isSlideDownArmed(offset: number): boolean {
  return offset >= SLIDE_TO_CALL_DISTANCE_PX;
}

/** How far along the track the knob sits, as a 0–1 fraction. */
export function slideDownFraction(offset: number): number {
  return clampSlideOffset(offset) / SLIDE_TO_CALL_DISTANCE_PX;
}

/** Whether the pointer has wandered sideways enough to abandon the slide. */
export function isHorizontalSlide(dx: number, dy: number): boolean {
  return Math.abs(dx) > HORIZONTAL_CANCEL_PX && Math.abs(dx) > Math.abs(dy);
}
