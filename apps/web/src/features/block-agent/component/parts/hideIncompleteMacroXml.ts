/**
 * Hide a trailing unclosed Macro mention tag so streaming text does not
 * flash raw `<m-document-mention>` XML. Complete tags stay intact.
 */
export function hideIncompleteMacroXml(text: string): string {
  const open = text.lastIndexOf('<m-');
  if (open === -1) return text;
  const after = text.slice(open);
  if (/^<m-[a-zA-Z0-9_-]+>[\s\S]*<\/m-[a-zA-Z0-9_-]+>/.test(after)) {
    return text;
  }
  return text.slice(0, open);
}
