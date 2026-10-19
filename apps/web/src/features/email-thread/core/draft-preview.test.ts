import { expect, it } from 'vitest';
import { draftPreviewText } from './draft-preview';

const html = (value: string) => ({
  body_html_sanitized: btoa(value),
  body_text: null,
  snippet: null,
});

it('previews what the reply says, not the thread it quotes', () => {
  expect(
    draftPreviewText(
      html(
        '<div><span>Sounds good,</span></div><div><span>see you then</span></div>' +
          '<div class="macro_quote gmail_quote">On Oct 11, Jonas wrote: the old message</div>'
      )
    )
  ).toBe('Sounds good, see you then');
});

it('falls back to plain text for drafts saved without HTML', () => {
  expect(
    draftPreviewText({
      body_html_sanitized: null,
      body_text: 'Offline\n  reply',
      snippet: null,
    })
  ).toBe('Offline reply');
});
