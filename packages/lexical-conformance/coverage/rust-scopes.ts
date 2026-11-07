/** Conservative source ranges: test-gated items cannot own production behavior. */
export function testOnlyRanges(source: string): [number, number][] {
  // Preserve offsets while hiding braces and attributes in comments and literals.
  const literals =
    /\/\*|\/\/[^\n]*|r(#{0,255})"[\s\S]*?"\1|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\\n])'/g;
  const pieces: string[] = [];
  let previous = 0;
  for (
    let token = literals.exec(source);
    token;
    token = literals.exec(source)
  ) {
    pieces.push(source.slice(previous, token.index));
    let end = literals.lastIndex;
    if (token[0] === '/*') {
      let depth = 1;
      const comments = /\/\*|\*\//g;
      comments.lastIndex = end;
      for (
        let delimiter = comments.exec(source);
        delimiter;
        delimiter = comments.exec(source)
      ) {
        depth += delimiter[0] === '/*' ? 1 : -1;
        end = comments.lastIndex;
        if (depth === 0) break;
      }
      if (depth !== 0) end = source.length;
    }
    pieces.push(source.slice(token.index, end).replace(/[^\n]/g, ' '));
    previous = end;
    literals.lastIndex = end;
  }
  const code = pieces.join('') + source.slice(previous);
  const ranges: [number, number][] = [];
  const scopes: (number | undefined)[] = [];
  let pending: number | undefined;
  for (const token of code.matchAll(
    /#\s*\[\s*cfg\s*\([\s\S]*?\)\s*\]|[{};]/g
  )) {
    const at = token.index;
    if (token[0].startsWith('#')) {
      // Reject compound cfgs mentioning test too; false negatives remain pending.
      if (/\btest\b/.test(token[0])) pending = at;
    } else if (token[0] === '{') {
      scopes.push(pending);
      pending = undefined;
    } else if (token[0] === '}') {
      const start = scopes.pop();
      if (start !== undefined) ranges.push([start, at + 1]);
      pending = undefined;
    } else if (pending !== undefined) {
      ranges.push([pending, at + 1]);
      pending = undefined;
    }
  }
  // An incomplete test-gated item cannot establish an implementation owner.
  for (const start of [...scopes, pending])
    if (start !== undefined) ranges.push([start, source.length]);
  return ranges;
}
