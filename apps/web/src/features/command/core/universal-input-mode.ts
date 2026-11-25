import { searchOperatorSpans } from '@app/features/next-soup/core/search-operators';

const UNIVERSAL_INPUT_CHARACTERS = 34;

/** Keep a promoted draft in composer mode until it is cleared. */
export function shouldUseUniversalInput(text: string, active = false): boolean {
  const query = text.trim();
  if (!query) return false;
  return active || query.length >= UNIVERSAL_INPUT_CHARACTERS;
}

/**
 * The phone Search's rule, whose field reads search operators: they say how
 * to search, not what, so they don't count toward the length that promotes a
 * search, and a search narrowed by several of them stays a search.
 */
export function shouldUseUniversalInputForSearch(
  text: string,
  active = false
): boolean {
  if (!text.trim()) return false;
  if (active) return true;
  let words = '';
  let at = 0;
  for (const { start, end } of searchOperatorSpans(text)) {
    words += text.slice(at, start);
    at = end;
  }
  return shouldUseUniversalInput(words + text.slice(at));
}
