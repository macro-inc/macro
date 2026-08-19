/**
 * Quote markdown the way a reply does: existing quote markers are flattened
 * (never nested) and every line is prefixed with `> `. Returns undefined for
 * whitespace-only content.
 */
export function quoteMarkdown(content: string): string | undefined {
  const flattened = content
    .trim()
    .split('\n')
    .map((line) => line.replace(/^\s*>+\s?/, ''))
    .join('\n')
    .trim();
  if (!flattened) return undefined;
  return flattened
    .split('\n')
    .map((line) => `> ${line}`)
    .join('\n');
}
