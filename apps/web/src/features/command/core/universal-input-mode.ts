import { searchOperatorSpans } from '@app/features/next-soup/core/search-operators';

const UNIVERSAL_INPUT_CHARACTERS = 34;

/** The text without its search operators, which say how to search, not what. */
function wordsOf(text: string) {
  let words = '';
  let at = 0;
  for (const { start, end } of searchOperatorSpans(text)) {
    words += text.slice(at, start);
    at = end;
  }
  return (words + text.slice(at)).replace(/\s+/g, ' ').trim();
}

/**
 * Keep a promoted draft in composer mode until it is cleared. Typed search
 * operators don't count toward the length that promotes a search, so a
 * search narrowed by several of them stays a search.
 */
export function shouldUseUniversalInput(text: string, active = false): boolean {
  const query = text.trim();
  if (!query) return false;
  return active || wordsOf(query).length >= UNIVERSAL_INPUT_CHARACTERS;
}
