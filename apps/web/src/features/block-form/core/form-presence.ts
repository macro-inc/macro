/**
 * What editors of one form have selected in the builder, as they publish it
 * to each other.
 */

/** What one editor has selected. */
export type FormSelection = {
  sectionId: string;
  /** `null` when the section itself is selected. */
  questionId: string | null;
};

const isId = (value: unknown): value is string =>
  typeof value === 'string' && value !== '';

/** Whether a value another client published is a selection this one reads. */
export function isFormSelection(value: unknown): value is FormSelection {
  if (typeof value !== 'object' || value === null) return false;
  if (!('sectionId' in value) || !('questionId' in value)) return false;
  return (
    isId(value.sectionId) &&
    (value.questionId === null || isId(value.questionId))
  );
}
