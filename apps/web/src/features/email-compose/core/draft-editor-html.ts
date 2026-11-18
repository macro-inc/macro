import type { EmailMessage } from '../../email-message/core/email-message';
import { decodeBase64Utf8 } from './decode-base64';

/**
 * Quoted-thread markup other mail clients write. The composer's own quotes
 * are a `.macro_quote` block or the editor's `md-quote` blockquotes.
 */
const PROVIDER_QUOTE_SELECTOR = [
  '.gmail_quote',
  '#divRplyFwdMsg',
  '#appendonsend',
  '#stop_reply_editing',
  '#mail-editor-reference-message-container',
  '[data-test-id="message-viewer-reply-separator"]',
].join(', ');

/**
 * "On <date> <sender> wrote:", as Gmail, Superhuman and Apple Mail write it.
 * No word boundary before "On": a `<br>` adds no text, so the attribution
 * runs straight on from the reply ("do itOn Mon, ...").
 */
const ATTRIBUTION = /On\s[\s\S]{0,400}?\bwrote:/;

/**
 * The HTML a saved draft seeds the composer with, or `undefined` when it has
 * no HTML body.
 *
 * A reply started in another client (Superhuman, Gmail, Outlook) and synced
 * here carries that client's copy of the quoted thread as ordinary markup.
 * The composer appends its own quote when it sends, so seeding the editor
 * with the whole body sends the thread twice and shows it inline in the sent
 * message. Seed such a draft with the server's replyless body instead.
 */
export function draftEditorHtml(
  draft: Pick<
    EmailMessage,
    'body_html_sanitized' | 'body_replyless' | 'replying_to_id'
  >
): string | undefined {
  const encoded = draft.body_html_sanitized;
  if (!encoded) return undefined;
  const html = decodeBase64Utf8(encoded);
  const replyless = draft.body_replyless?.trim();
  if (!draft.replying_to_id || !replyless) return html;
  return carriesProviderQuote(html) ? trimTrailingBreaks(replyless) : html;
}

function carriesProviderQuote(html: string): boolean {
  const { body } = new DOMParser().parseFromString(html, 'text/html');
  // The composer's own quoted thread: it is imported and re-sent as is.
  if (body.querySelector('.macro_quote')) return false;
  if (body.querySelector(PROVIDER_QUOTE_SELECTOR)) return true;
  // A plain blockquote under an attribution line. Blockquotes the editor
  // wrote carry `md-quote` and are the user's own content.
  return (
    !!body.querySelector('blockquote:not(.md-quote)') &&
    ATTRIBUTION.test(body.textContent ?? '')
  );
}

/** The cut leaves the blank lines that separated the reply from the thread. */
function trimTrailingBreaks(html: string): string {
  return html.replace(/(?:\s|<br\s*\/?>)+$/i, '');
}
