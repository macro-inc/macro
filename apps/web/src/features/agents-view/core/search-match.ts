/** Match against original text so Unicode case folding never shifts display offsets. */
export function literalSearchRange(text: string, query: string | undefined) {
  const term = query?.trim();
  if (!term) return undefined;
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(escaped, 'iu').exec(text);
  return match
    ? { start: match.index, end: match.index + match[0].length }
    : undefined;
}
