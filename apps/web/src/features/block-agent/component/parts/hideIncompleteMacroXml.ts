/**
 * Hide a trailing unclosed Macro mention tag so agent text does not
 * flash raw `<m-document-mention>` XML. Complete tags and code stay intact.
 */
export function hideIncompleteMacroXml(text: string): string {
  const open = text.lastIndexOf('<m-');
  if (open === -1) return text;
  if (isInCode(text, open)) return text;
  const after = text.slice(open);
  if (/^<m-[a-zA-Z0-9_-]+>[\s\S]*<\/m-[a-zA-Z0-9_-]+>/.test(after)) {
    return text;
  }
  return text.slice(0, open);
}

/** Follow Lexical's backtick fences, including fences still being streamed. */
function isInCode(text: string, position: number): boolean {
  let closingFence: RegExp | undefined;
  let offset = 0;
  for (const line of text.split('\n')) {
    const containsPosition = position < offset + line.length + 1;
    if (closingFence) {
      if (containsPosition) return true;
      if (closingFence.test(line.trimEnd())) closingFence = undefined;
    } else {
      const fence = /^[ \t]*(`{3,})/.exec(line);
      if (fence) {
        if (containsPosition) return true;
        const length = fence[1].length;
        const rest = line.trimEnd().slice(fence[0].length);
        if (!new RegExp(`\`{${length},}$`).test(rest)) {
          closingFence = new RegExp(`^[ \\t]*\`{${length},}$`);
        }
      } else if (containsPosition) {
        for (const span of line.matchAll(/(^|[^\\`])(`+)(.*?)\2(?!`)/g)) {
          const start = offset + span.index + span[1].length;
          const end = offset + span.index + span[0].length;
          if (position >= start && position < end) return true;
        }
        return false;
      }
    }
    offset += line.length + 1;
  }
  return false;
}
