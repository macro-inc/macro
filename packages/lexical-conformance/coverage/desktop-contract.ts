/** Inspect literal package name attributes within the assigned Nix list. */
export function desktopIncludesSession(source: string): boolean {
  const tokens = [
    ...source.matchAll(
      /#[^\n]*|\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|[A-Za-z_][\w-]*|[^\s]/g
    ),
  ]
    .map((match) => match[0])
    .filter((token) => !token.startsWith('#') && !token.startsWith('/*'));
  const assignment = tokens.findIndex(
    (token, index) => token === 'coreWasmPackages' && tokens[index + 1] === '='
  );
  if (assignment < 0) return false;
  let index = assignment + 2;
  // This contract accepts only the established map constructor or a literal list.
  if (tokens[index] === 'map' && tokens[index + 1] === 'mkCoreWasmPackage')
    index += 2;
  if (tokens[index++] !== '[') return false;
  let depth = 0;
  while (index < tokens.length) {
    const token = tokens[index++];
    if (token === ']' && depth === 0) return false;
    if (token === '{') depth++;
    if (token === '}') depth--;
    if (
      depth === 1 &&
      token === 'name' &&
      tokens[index] === '=' &&
      tokens[index + 1] === '"document_session_wasm"' &&
      tokens[index + 2] === ';'
    )
      return true;
  }
  return false;
}
