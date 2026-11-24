// Format characters (direction marks, zero-width spaces, a byte order mark),
// separators and punctuation before the name's first letter.
const LEADING_NOISE = /^[\p{Cf}\p{Z}\p{P}\s]+/u;

/**
 * An agent teammate's avatar letter: the first character of its name as the
 * reader sees it (one grapheme, so an emoji, a combining accent or a CJK
 * character stays whole), upper-cased, after any invisible marks or
 * punctuation. People keep their two initials.
 */
export function agentInitial(name: string): string {
  const first = firstGrapheme(name.replace(LEADING_NOISE, ''));
  if (!first) return '?';
  const upper = first.toUpperCase();
  // Some letters upper-case to two (ß to SS); keep those as written.
  return firstGrapheme(upper) === upper ? upper : first;
}

function firstGrapheme(text: string): string | undefined {
  return new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    .segment(text)
    [Symbol.iterator]()
    .next().value?.segment;
}
