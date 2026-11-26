/**
 * `String.prototype.replace` with an async replacer: every match of `pattern`
 * (which must be global) in `text` becomes what `replace` resolves to. The
 * replacers run concurrently; the result keeps the matches' order.
 */
export async function replaceAll(
  text: string,
  pattern: RegExp,
  replace: (match: RegExpExecArray) => Promise<string>
): Promise<string> {
  const matches = [...text.matchAll(pattern)];
  if (!matches.length) return text;
  const replacements = await Promise.all(matches.map(replace));
  let out = '';
  let at = 0;
  matches.forEach((match, i) => {
    out += text.slice(at, match.index) + replacements[i];
    at = match.index + match[0].length;
  });
  return out + text.slice(at);
}
