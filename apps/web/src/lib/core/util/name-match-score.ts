/** Text up to this length (any row's name) is remembered with the others. */
const REMEMBERED_TEXT_LENGTH = 1_000;
/** Remembered text past this many characters in all is forgotten. */
const REMEMBERED_CHARACTERS = 4_000_000;

/** A string that shares no memory with the one it came from: text trimmed
 * from a long paste can, which a remembered key or its words would keep
 * alive. Joining single characters makes new text in every engine, where a
 * slice of joined text can still keep the original. */
const copyOf = (value: string) => value.split('').join('');

/** Remembers a pure string function's answers. Ranking thousands of rows
 * reads the same names on every keystroke; the bounds only cap memory.
 * Longer text is computed each time; a ranking pass prepares a long query
 * once instead (`nameQuery`). */
function rememberText<R>(compute: (value: string) => R) {
  const known = new Map<string, R>();
  let characters = 0;
  return (value: string): R => {
    if (value.length > REMEMBERED_TEXT_LENGTH) return compute(value);
    const hit = known.get(value);
    if (hit !== undefined) return hit;
    const text = copyOf(value);
    const result = compute(text);
    if (
      known.size >= 50_000 ||
      characters + text.length > REMEMBERED_CHARACTERS
    ) {
      known.clear();
      characters = 0;
    }
    known.set(text, result);
    characters += text.length;
    return result;
  };
}

const normalize = (value: string) =>
  value
    .split(/\p{White_Space}+/u)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
const normalizedText = rememberText(normalize);
const normalizedQuery = rememberText(normalize);

/** Mirrors subsequence_match::ranking; shared fixtures freeze this per-row rule.
 * It never normalizes a score against the other rows in a result window. */
export function normalizeNameText(value: string): string {
  return normalizedText(value);
}

const WORD_BREAK = /[^\p{Alphabetic}\p{Number}]+/u;

const wordsIn = (text: string): readonly string[] =>
  text.split(WORD_BREAK).filter(Boolean);
const wordsOf = rememberText((text) => wordsIn(text.toLowerCase()));
const queryParts = rememberText((query) => wordsIn(normalizedQuery(query)));

/** A query read for every row of a ranking pass, normalized once: its text
 * as `normalizeNameText` gives it, and that text's words. */
export type NameQuery = {
  readonly term: string;
  readonly parts: readonly string[];
};

/** Prepares a query for a ranking pass. Rows given the result skip
 * normalizing it, which costs a pasted query's length on every row. Its
 * words are split when first read. */
export function nameQuery(query: string): NameQuery {
  const term = normalizedQuery(query);
  let parts: readonly string[] | undefined;
  return {
    term,
    get parts() {
      parts ??= wordsIn(term);
      return parts;
    },
  };
}

const termOf = (query: string | NameQuery) =>
  typeof query === 'string' ? normalizedQuery(query) : query.term;

/** Whether every query term starts a word of the text, as the native people
 * ranker's word-prefix tier decides it: punctuation separates words. */
export function startsWordsOf(
  text: string,
  query: string | NameQuery
): boolean {
  const words = wordsOf(text);
  const parts = typeof query === 'string' ? queryParts(query) : query.parts;
  return parts.every((part) => words.some((word) => word.startsWith(part)));
}

function span(
  text: string,
  query: string
): { start: number; length: number } | undefined {
  let first = Infinity;
  let last = 0;
  for (const token of query.split(' ')) {
    const contiguous = text.indexOf(token);
    if (contiguous >= 0) {
      first = Math.min(first, contiguous);
      last = Math.max(last, contiguous + token.length);
      continue;
    }
    let position = 0;
    for (const character of token) {
      const start = text.indexOf(character, position);
      if (start < 0) return undefined;
      first = Math.min(first, start);
      position = start + character.length;
      last = Math.max(last, position);
    }
  }
  return { start: first, length: last - first };
}

export function nameMatchRank(
  label: string,
  query: string | NameQuery
): number {
  const term = termOf(query);
  if (!term) return 0;
  const name = normalizeNameText(label);
  if (name === term) return 2;
  return name.startsWith(term) ? 1 : 0;
}

export function nameMatchQuality(
  label: string,
  text: string,
  query: string | NameQuery,
  gapWeight: number,
  startDecay: number
): number | undefined {
  const term = termOf(query);
  if (!term) return 1;
  const textSpan = span(normalizeNameText(text), term);
  if (!textSpan) return undefined;
  const match =
    label === text
      ? textSpan
      : (span(normalizeNameText(label), term) ?? textSpan);
  const ratio = Math.min(1, term.length / Math.max(1, match.length));
  return (
    (1 - (1 - ratio) * Math.max(0, Math.min(1, gapWeight))) /
    (1 + match.start * Math.max(0, startDecay))
  );
}
