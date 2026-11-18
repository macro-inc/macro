/** What the Reviews list header has given up so its actions fit. */
export type ReviewsHeaderRoom = {
  /** Steps applied, in order: icon-only status tabs, then no scope name. */
  steps: number;
  /** Width each step freed, recorded while it was not applied. */
  freed: readonly (number | undefined)[];
};

export type ReviewsHeaderMeasure = {
  /** How far the actions run past their row. */
  overflow: number;
  /** Empty width at the start of the actions row. */
  slack: number;
};

/**
 * Takes the next step while the actions overflow and undoes the last one
 * only when the room it freed is free again, so a step never flips back and
 * forth at one width.
 */
export function nextReviewsHeaderSteps(
  room: ReviewsHeaderRoom,
  available: number,
  measure: ReviewsHeaderMeasure
): number {
  const steps = Math.min(room.steps, available);
  if (measure.overflow > 0) return Math.min(steps + 1, available);
  if (steps === 0) return 0;
  const freed = room.freed[steps - 1];
  return freed !== undefined && measure.slack >= freed + 1 ? steps - 1 : steps;
}
