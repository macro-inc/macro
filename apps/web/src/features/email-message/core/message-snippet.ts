import type { EmailMessage } from './email-message';

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
 * `textContent` concatenates text nodes with no separator, so adjacent block
 * elements would otherwise run together ("Hey Kyle!First,").
 */
function textFromHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  for (const el of doc.body.querySelectorAll(LINE_BREAKING_ELEMENTS)) {
    el.before(' ');
    el.after(' ');
  }
  return collapseWhitespace(doc.body.textContent ?? '');
}

function textFromMarkdown(markdown: string): string {
  const withoutMarkup = markdown
    .replace(/!\[[^\]]*]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)]\([^)]*\)/g, '$1')
    .replace(/(\*\*|__)([\s\S]*?)\1/g, '$2')
    .replace(/(\*|_)([\s\S]*?)\1/g, '$2')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/\[([^\]]+)]/g, '$1')
    .replace(/^#{1,6}\s+/gm, '');
  return collapseWhitespace(withoutMarkup);
}

type SnippetMessage = Pick<
  EmailMessage,
  'body_html_sanitized' | 'body_macro' | 'body_replyless' | 'body_text'
>;

function nonEmpty(value: string | null | undefined): string | undefined {
  if (!value || !value.trim()) return undefined;
  return value;
}

/**
 * One-line collapsed-thread preview. Macro-authored mail (`body_macro`) is
 * converted from the rendered HTML, or from markdown when HTML is missing, so
 * signature emphasis and links do not show as `*…*` / `[text](url)`. Prefer
 * `body_replyless` so quoted thread history is not part of the preview.
 * Received mail keeps the existing plaintext-first preview.
 */
export function messageSnippet(message: SnippetMessage): string {
  const html =
    nonEmpty(message.body_replyless) ?? nonEmpty(message.body_html_sanitized);
  const markdown = nonEmpty(message.body_macro);
  const text = collapseWhitespace(message.body_text ?? '');

  if (markdown) {
    if (html) {
      const fromHtml = textFromHtml(html);
      if (fromHtml) return fromHtml;
    }
    return textFromMarkdown(markdown);
  }

  if (text) return text;
  if (html) return textFromHtml(html);
  return '';
}
