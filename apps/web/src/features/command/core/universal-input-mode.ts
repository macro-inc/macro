const UNIVERSAL_INPUT_WORDS = 3;
const UNIVERSAL_INPUT_CHARACTERS = 24;

/** Keep a promoted draft in composer mode until it is cleared. */
export function shouldUseUniversalInput(text: string, active = false): boolean {
  const query = text.trim();
  if (!query) return false;
  return (
    active ||
    query.length >= UNIVERSAL_INPUT_CHARACTERS ||
    query.split(/\s+/).length >= UNIVERSAL_INPUT_WORDS
  );
}
