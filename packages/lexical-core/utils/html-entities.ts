/** The HTML entities models write in place of characters, and the characters. */
export const HTML_ENTITIES: Readonly<Record<string, string>> = {
  '&amp;': '&',
  '&nbsp;': ' ',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&copy;': '©',
  '&reg;': '®',
  '&trade;': '™',
};

const ENTITY = new RegExp(Object.keys(HTML_ENTITIES).join('|'), 'gi');

/** `text` with each entity read once as its character, so `&amp;lt;` stays `&lt;`. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    ENTITY,
    (entity) => HTML_ENTITIES[entity.toLowerCase()] ?? entity
  );
}
