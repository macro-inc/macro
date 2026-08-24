/** Viewport-percent placement for the skip button in onboarding hard mode. */
export type SkipPosition = {
  left: number;
  top: number;
};

/**
 * Bottom-left region reserved for the Hard mode switch, in percent of the
 * onboarding surface. Skip must not land here or the switch is unclickable.
 */
export const HARD_MODE_SWITCH_ZONE = {
  maxLeft: 32,
  minTop: 78,
} as const;

const PAD = 8;
const MAX_LEFT = 84;
const MAX_TOP = 82;

/** Delay before a hard-mode skip jumps, in milliseconds. */
export const SKIP_JUMP_DELAY_MS = { min: 200, max: 1500 } as const;

/**
 * Pick a skip-button origin in percent. `rng` is injectable so tests can
 * pin the result; production passes `Math.random`.
 */
export function randomSkipPosition(
  rng: () => number = Math.random
): SkipPosition {
  let left = PAD + rng() * MAX_LEFT;
  let top = PAD + rng() * MAX_TOP;
  if (
    left < HARD_MODE_SWITCH_ZONE.maxLeft &&
    top > HARD_MODE_SWITCH_ZONE.minTop
  ) {
    left =
      HARD_MODE_SWITCH_ZONE.maxLeft +
      rng() * (PAD + MAX_LEFT - HARD_MODE_SWITCH_ZONE.maxLeft);
  }
  return { left, top };
}

/** Wait this long after a skip appears (or jumps) before it jumps again. */
export function randomSkipJumpDelayMs(rng: () => number = Math.random): number {
  return (
    SKIP_JUMP_DELAY_MS.min +
    rng() * (SKIP_JUMP_DELAY_MS.max - SKIP_JUMP_DELAY_MS.min)
  );
}
