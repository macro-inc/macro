/**
 * How the search service reads the terms of a query, for every field that
 * reads its operators: the Search view's and Mail's
 * (`crates/search_service/src/api/search/terms.rs`).
 */

/**
 * Whether an operator's value can name something: a letter, a digit, or
 * another non-ASCII character such as an emoji, so `tag:🔥` and Mail's
 * `label:🔥` name a tag while ASCII punctuation alone (`tag:-`) stays a word,
 * as the service reads it.
 */
export const namesSomething = (value: string) =>
  /[\p{Alphabetic}\p{N}]|[^\p{ASCII}\s]/u.test(value);

/** Quotes a phrase is typed with, as the service reads them. */
const PHRASE_QUOTES = /["“”„]/;

/** Whether `char` opens or closes a phrase, as the service reads it. */
export const isPhraseQuote = (char: string) => PHRASE_QUOTES.test(char);

/**
 * `name` as a typed value can hold it: a query's terms drop the phrase
 * quotes they're typed with, so a tag named `Q3 "Plan"` is typed as
 * `tag:"Q3 Plan"`.
 */
export const nameAsTyped = (name: string) =>
  [...name].filter((char) => !isPhraseQuote(char)).join('');
