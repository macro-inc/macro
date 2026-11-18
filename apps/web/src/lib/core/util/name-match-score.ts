/** Text up to this length (any row's name) is remembered with the others. */
const REMEMBERED_TEXT_LENGTH = 1_000;
/** Remembered text past this many characters in all is forgotten. */
const REMEMBERED_CHARACTERS = 4_000_000;
/** Longer queries kept at once: a paste and its normalized text. */
const KEPT_PASTES = 2;

/** A string that shares no memory with the one it came from: text trimmed
 * from a long paste can, which a remembered key or its words would keep
 * alive. Joining single characters makes new text in every engine, where a
 * slice of joined text can still keep the original. */
const copyOf = (value: string) => value.split('').join('');

/** Remembers a pure string function's answers. Ranking thousands of rows
 * reads the same names on every keystroke; the bounds only cap memory. A
 * query is read once for every row ranked against it, so a query's function
 * also keeps the latest texts too long to remember with the others while
 * the task that ranks against them runs. */
function rememberText<R>(
  compute: (value: string) => R,
  of: 'names' | 'queries'
) {
  const known = new Map<string, R>();
  let characters = 0;
  let pastes: { text: string; result: R }[] = [];
  const forgetPastes = () => {
    pastes = [];
  };
  return (value: string): R => {
    if (value.length > REMEMBERED_TEXT_LENGTH) {
      if (of === 'names') return compute(value);
      const kept = pastes.find((paste) => paste.text === value);
      if (kept) return kept.result;
      // Kept as given: forgotten with the task, it needs no copy.
      const paste = { text: value, result: compute(value) };
      if (!pastes.length) setTimeout(forgetPastes, 0);
      pastes = [paste, ...pastes].slice(0, KEPT_PASTES);
      return paste.result;
    }
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
const normalizedText = rememberText(normalize, 'names');
const normalizedQuery = rememberText(normalize, 'queries');

/** Mirrors subsequence_match::ranking; shared fixtures freeze this per-row rule.
 * It never normalizes a score against the other rows in a result window. */
export function normalizeNameText(value: string): string {
  return normalizedText(value);
}

/** `normalizeNameText` for a query each row is ranked against: a longer
 * query, such as a paste, is kept too. */
export function normalizeQueryText(value: string): string {
  return normalizedQuery(value);
}

const WORD_BREAK = /[^\p{Alphabetic}\p{Number}]+/u;

const wordsOf = rememberText(
  (text): readonly string[] =>
    text.toLowerCase().split(WORD_BREAK).filter(Boolean),
  'names'
);

const queryParts = rememberText(
  (query): readonly string[] =>
    normalizedQuery(query).split(WORD_BREAK).filter(Boolean),
  'queries'
);

/** Whether every query term starts a word of the text, as the native people
 * ranker's word-prefix tier decides it: punctuation separates words. */
export function startsWordsOf(text: string, query: string): boolean {
  const words = wordsOf(text);
  return queryParts(query).every((part) =>
    words.some((word) => word.startsWith(part))
  );
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

export function nameMatchRank(label: string, query: string): number {
  const term = normalizedQuery(query);
  if (!term) return 0;
  const name = normalizeNameText(label);
  if (name === term) return 2;
  return name.startsWith(term) ? 1 : 0;
}

export function nameMatchQuality(
  label: string,
  text: string,
  query: string,
  gapWeight: number,
  startDecay: number
): number | undefined {
  const term = normalizedQuery(query);
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
