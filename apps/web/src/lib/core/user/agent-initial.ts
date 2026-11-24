/**
 * An agent teammate's avatar letter: the first character of its name as the
 * reader sees it (one grapheme, so an emoji, a combining accent or a CJK
 * character stays whole), upper-cased. People keep their two initials.
 */
export function agentInitial(name: string): string {
  const first = new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    .segment(name.trim())
    [Symbol.iterator]()
    .next().value?.segment;
  return first ? first.toUpperCase() : '?';
}
