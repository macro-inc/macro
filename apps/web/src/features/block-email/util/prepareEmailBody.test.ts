// @vitest-environment jsdom
import type { ApiMessage } from '@service-email/generated/schemas';
import { describe, expect, it } from 'vitest';
import { prepareEmailBodyFromHtml } from './prepareEmailBody';

function decodeBodyHtml(encoded: string) {
  const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
  return decodeURIComponent(escape(atob(base64)));
}

const replyingTo = {
  from: { name: 'Ada Lovelace', email: 'ada@example.com' },
  to: [],
  cc: [],
  bcc: [],
  subject: 'Numbers',
  body_text: 'original message text',
  internal_date_ts: '2026-08-01T12:00:00Z',
  attachments: [],
} as unknown as ApiMessage;

describe('prepareEmailBodyFromHtml', () => {
  it('does not add a quote block without appendReply (undo-send restore)', () => {
    const prepared = prepareEmailBodyFromHtml('<p>hi there</p>');
    const decoded = decodeBodyHtml(prepared.bodyHtml);
    expect(decoded).toContain('hi there');
    expect(decoded).not.toContain('macro_quote');
  });

  it('appends the replied-to message when appendReply is provided', () => {
    const prepared = prepareEmailBodyFromHtml('<p>hi there</p>', {
      replyType: 'reply',
      replyingTo,
    });
    const decoded = decodeBodyHtml(prepared.bodyHtml);
    const body = new DOMParser().parseFromString(decoded, 'text/html').body;
    const quotes = body.querySelectorAll('.macro_quote');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].textContent).toContain('original message text');
    expect(quotes[0].textContent).toContain('wrote:');
  });

  it('does not double-append when the quote is already in the body', () => {
    const prepared = prepareEmailBodyFromHtml(
      '<p>hi there</p><div class="macro_quote gmail_quote">already quoted</div>',
      { replyType: 'reply', replyingTo }
    );
    const decoded = decodeBodyHtml(prepared.bodyHtml);
    const body = new DOMParser().parseFromString(decoded, 'text/html').body;
    const quotes = body.querySelectorAll('.macro_quote');
    expect(quotes).toHaveLength(1);
    expect(quotes[0].textContent).toContain('already quoted');
  });
});
