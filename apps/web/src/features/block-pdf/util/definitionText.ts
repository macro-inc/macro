export function decodeDefinitionText(element: Element): string {
  const lineBreaks = /<br\/>/g;
  const endBreak = /(?<=.)(<br\/>)$/g;
  if (!element.innerHTML) return '';
  return element.innerHTML
    .replaceAll(endBreak, '')
    .replaceAll(lineBreaks, '\r\n\n');
}
