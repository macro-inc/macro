import { decodeBase64Utf8 } from '@app/features/email-compose/core/decode-base64';
import type { EmailMessage } from '@app/features/email-message/core/email-message';

/**
 * What a draft reply says so far, on one line and without the thread it
 * quotes. Saved drafts usually carry only HTML; a snippet or plain text is
 * the fallback.
 */
export function draftPreviewText(
  draft: Pick<EmailMessage, 'body_html_sanitized' | 'body_text' | 'snippet'>
): string {
  const encoded = draft.body_html_sanitized;
  const text = encoded
    ? htmlText(decodeBase64Utf8(encoded))
    : (draft.body_text ?? draft.snippet ?? '');
  return text.replace(/\s+/g, ' ').trim();
}

function htmlText(html: string) {
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  for (const quote of body.querySelectorAll('.macro_quote, .gmail_quote'))
    quote.remove();
  // Paragraphs are adjacent elements; keep their words apart.
  for (const block of body.querySelectorAll('p, div, li, br, h1, h2, h3'))
    block.after(' ');
  return body.textContent ?? '';
}
