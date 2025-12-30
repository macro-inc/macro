const MACRO_EM_RE = /<macro_em>([\s\S]*?)<\/macro_em>/;

function truncateMiddle(text: string, max: number): string {
  if (text.length <= max) return text;
  const head = Math.floor((max - 3) / 2);
  const tail = max - 3 - head;
  return text.slice(0, head) + '...' + text.slice(text.length - tail);
}

/**
 * Modify the incoming string from a search service string to show the matching
 * macro-em tag within the char window of a view rendering a list of search
 * results.
 * @param body
 * @param chars
 * @returns
 */
export function truncateSearchMatchMarkdown(
  body: string,
  chars: number
): string {
  const lines = body.split('\n');
  const line = lines.find((l) => MACRO_EM_RE.test(l));

  if (!line) {
    return body.length <= chars ? body : body.slice(0, chars - 3) + '...';
  }

  const match = line.match(MACRO_EM_RE)!;
  const inner = match[1];

  const before = line.slice(0, match.index!);
  const after = line.slice(match.index! + match[0].length);

  if (inner.length >= chars) {
    return `<macro_em>${truncateMiddle(inner, chars)}</macro_em>`;
  }

  let remaining = chars - inner.length;

  let prefixTake = Math.floor(remaining / 2);
  let suffixTake = remaining - prefixTake;

  let prefix = before.slice(-prefixTake);
  let suffix = after.slice(0, suffixTake);

  const prefixEllipsis = prefix.length < before.length ? '...' : '';
  const suffixEllipsis = suffix.length < after.length ? '...' : '';

  return (
    prefixEllipsis +
    prefix +
    `<macro_em>${inner}</macro_em>` +
    suffix +
    suffixEllipsis
  );
}
