import type { ApiMessage } from '@service-email/generated/schemas';

/**
 * Elements that render on their own line, so the boundary between one of them
 * and the text around it is a word break rather than nothing.
 */
const LINE_BREAKING_ELEMENTS = [
  'address',
  'article',
  'aside',
  'blockquote',
  'br',
  'dd',
  'div',
  'dl',
  'dt',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'td',
  'th',
  'tr',
  'ul',
].join(',');

const collapseWhitespace = (text: string): string =>
  text.replace(/\s+/g, ' ').trim();

/**
 * One-line text of an HTML email body, for the collapsed message preview.
 *
 * `textContent` concatenates text nodes with no separator, so a body whose
 * paragraphs render on separate lines comes back with the words run together
 * ("Hey Kyle!First,"). Collapsing whitespace afterwards cannot recover the
 * break because there is no whitespace there to collapse, so line-breaking
 * elements get an explicit newline first. Runs of inserted newlines collapse
 * to the single space that separates the two lines.
 */
export const htmlToSnippetText = (html: string): string => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const element of doc.body.querySelectorAll(LINE_BREAKING_ELEMENTS)) {
    element.before('\n');
    element.after('\n');
  }
  return collapseWhitespace(doc.body.textContent ?? '');
};

/**
 * Preview text for a message, preferring the plain-text body. Newlines there
 * are already whitespace, so collapsing is enough.
 */
export const messageSnippet = (message: ApiMessage): string => {
  if (message.body_text) return collapseWhitespace(message.body_text);
  if (message.body_html_sanitized) {
    return htmlToSnippetText(message.body_html_sanitized);
  }
  return '';
};
