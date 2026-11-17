/** A run of text that both versions share, or that only one has. */
export type DiffPart = { text: string; change: 'same' | 'added' | 'removed' };

/** Above this many token pairs, a diff is whole rather than computed. */
const MAX_CELLS = 4_000_000;

/** The longest common subsequence diff of two token lists, merged into runs. */
function diffTokens(before: string[], after: string[]): DiffPart[] {
  if (before.length * after.length > MAX_CELLS)
    return [
      { text: before.join(''), change: 'removed' },
      { text: after.join(''), change: 'added' },
    ];
  // lengths[i][j]: the common subsequence of before[i..] and after[j..].
  const lengths = Array.from({ length: before.length + 1 }, () =>
    new Array<number>(after.length + 1).fill(0)
  );
  for (let i = before.length - 1; i >= 0; i--)
    for (let j = after.length - 1; j >= 0; j--)
      lengths[i]![j] =
        before[i] === after[j]
          ? lengths[i + 1]![j + 1]! + 1
          : Math.max(lengths[i + 1]![j]!, lengths[i]![j + 1]!);
  const parts: DiffPart[] = [];
  const push = (text: string, change: DiffPart['change']) => {
    const last = parts.at(-1);
    if (last?.change === change) last.text += text;
    else parts.push({ text, change });
  };
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      push(before[i]!, 'same');
      i++;
      j++;
    } else if (lengths[i + 1]![j]! >= lengths[i]![j + 1]!)
      push(before[i++]!, 'removed');
    else push(after[j++]!, 'added');
  }
  while (i < before.length) push(before[i++]!, 'removed');
  while (j < after.length) push(after[j++]!, 'added');
  return parts;
}

/** What changed between two sentences, word by word. */
export function diffWords(before: string, after: string): DiffPart[] {
  // Punctuation is its own token, so "days." and "days and more." share "days".
  const words = (text: string) =>
    text.match(/\s+|[.,;:!?()]|[^\s.,;:!?()]+/g) ?? [];
  return diffTokens(words(before), words(after));
}

/** What changed between two sources, line by line. */
export function diffLines(before: string, after: string): DiffPart[] {
  const lines = (text: string) => text.split(/(?<=\n)/);
  return diffTokens(lines(before), lines(after));
}
