const INFERABLE_WORDS = 3;
const INFERABLE_CHARACTERS = 24;

/** Enough of a thought for the classifier to read a type from. */
export function isInferable(text: string): boolean {
  const draft = text.trim();
  if (!draft) return false;
  return (
    draft.length >= INFERABLE_CHARACTERS ||
    draft.split(/\s+/).length >= INFERABLE_WORDS
  );
}

/** Keep a promoted draft in composer mode until it is cleared. */
export function shouldUseUniversalInput(text: string, active = false): boolean {
  if (!text.trim()) return false;
  return active || isInferable(text);
}
