/**
 * Option-delta shapes shared by both entity-property option transports. A
 * selection is sent as options to add and remove rather than as the desired
 * value, so a concurrent edit to the same property composes with it instead of
 * being clobbered.
 */

/** A property's reconciled final option ids after a bulk update. */
export type EntityPropertyOptionSelection = {
  propertyDefinitionId: string;
  optionIds: string[];
};

/** The options one property gains and loses to reach a selection. */
export type EntityPropertyOptionDeltas = {
  addOptionIds: string[];
  removeOptionIds: string[];
};

/** Derives one property's option delta from its current and next selection. */
export function getEntityPropertyOptionDeltas(
  currentOptionIds: readonly string[],
  nextOptionIds: readonly string[]
): EntityPropertyOptionDeltas {
  const current = new Set(currentOptionIds);
  const next = new Set(nextOptionIds);
  return {
    addOptionIds: nextOptionIds.filter((optionId) => !current.has(optionId)),
    removeOptionIds: currentOptionIds.filter((optionId) => !next.has(optionId)),
  };
}
