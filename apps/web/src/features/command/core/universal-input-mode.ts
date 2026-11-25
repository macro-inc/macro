import { isUnfinishedEmailSearchOperator } from '@app/features/email-view/search/email-search-operators';
import {
  isUnfinishedSearchOperator,
  searchOperatorSpans,
  splitSearchTerms,
} from '@app/features/next-soup/core/search-operators';

const UNIVERSAL_INPUT_CHARACTERS = 34;

/** Keep a promoted draft in composer mode until it is cleared. */
export function shouldUseUniversalInput(text: string, active = false): boolean {
  const query = text.trim();
  if (!query) return false;
  return active || query.length >= UNIVERSAL_INPUT_CHARACTERS;
}

/**
 * The phone Search's rule, whose field reads search operators: they say how
 * to search, not what, so neither whole ones nor ones still being typed count
 * toward the length that promotes a search, and a search narrowed by several
 * of them stays a search.
 */
export function shouldUseUniversalInputForSearch(
  text: string,
  active = false
): boolean {
  if (!text.trim()) return false;
  if (active) return true;
  let rest = '';
  let at = 0;
  for (const { start, end } of searchOperatorSpans(text)) {
    rest += text.slice(at, start);
    at = end;
  }
  rest += text.slice(at);
  const words = rest
    .split(/\s+/)
    .filter((token) => {
      const term = splitSearchTerms(token)[0] ?? token;
      return (
        !isUnfinishedSearchOperator(term) &&
        !isUnfinishedEmailSearchOperator(token)
      );
    })
    .join(' ');
  return shouldUseUniversalInput(words);
}
