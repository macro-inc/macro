/** Mirrors subsequence_match::ranking; shared fixtures freeze this per-row rule.
 * It never normalizes a score against the other rows in a result window. */
export function normalizeNameText(value: string): string {
  return value
    .split(/\p{White_Space}+/u)
    .filter(Boolean)
    .join(' ')
    .toLowerCase();
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
  const term = normalizeNameText(query);
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
  const term = normalizeNameText(query);
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
