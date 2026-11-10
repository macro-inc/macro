import { describe, expect, it } from 'vitest';
import { draftEditorHtml } from './draft-editor-html';

const REPLYLESS = '<span>Sounds good, let&#39;s do it</span><br><br><br>';

function draft(
  html: string,
  overrides: { replying_to_id?: string | null } = {}
) {
  return {
    body_html_sanitized: html,
    body_replyless: REPLYLESS,
    replying_to_id: 'parent',
    ...overrides,
  };
}

describe('the HTML a reopened draft seeds the composer with', () => {
  it('drops another client’s quoted thread so it is not sent twice', () => {
    // Superhuman puts the attribution in the reply's own block.
    const html =
      '<div>Sounds good, let&#39;s do it<br><br>On Mon, Nov 09, 2026 at 5:35 PM, Sam &lt;<a href="mailto:sam@example.com">sam@example.com</a>&gt; wrote:<br></div><blockquote><div>Can we talk?</div></blockquote>';

    expect(draftEditorHtml(draft(html))).toBe(
      '<span>Sounds good, let&#39;s do it</span>'
    );
  });

  it('drops a Gmail quote block', () => {
    const html =
      '<div>Sounds good</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Sam wrote:</div><blockquote>Can we talk?</blockquote></div>';

    expect(draftEditorHtml(draft(html))).toBe(
      '<span>Sounds good, let&#39;s do it</span>'
    );
  });

  it('drops an Outlook reply header', () => {
    const html =
      '<div>Sounds good</div><hr><div id="divRplyFwdMsg"><b>From:</b> Sam</div><div>Can we talk?</div>';

    expect(draftEditorHtml(draft(html))).toBe(
      '<span>Sounds good, let&#39;s do it</span>'
    );
  });

  it('keeps the composer’s own quoted thread', () => {
    const html =
      '<div>Sounds good</div><div class="macro_quote gmail_quote"><div class="gmail_attr">On Mon, Sam wrote:</div><blockquote>Can we talk?</blockquote></div>';

    expect(draftEditorHtml(draft(html))).toBe(html);
  });

  it('keeps quotes the user wrote in the editor', () => {
    const html =
      '<div class="md-p">On Monday you wrote:</div><blockquote class="md-quote">Can we talk?</blockquote><div class="md-p">Yes.</div>';

    expect(draftEditorHtml(draft(html))).toBe(html);
  });

  it('keeps a plain blockquote with no attribution', () => {
    const html = '<div>See below</div><blockquote>A citation</blockquote>';

    expect(draftEditorHtml(draft(html))).toBe(html);
  });

  it('keeps the whole body of a draft that is not a reply', () => {
    const html =
      '<div>FYI</div><div class="gmail_quote"><div class="gmail_attr">On Mon, Sam wrote:</div><blockquote>Hi</blockquote></div>';

    expect(draftEditorHtml(draft(html, { replying_to_id: null }))).toBe(html);
  });

  it('keeps the whole body when the server sent no replyless body', () => {
    const html =
      '<div>Hi</div><div class="gmail_quote"><blockquote>Hi</blockquote></div>';

    expect(draftEditorHtml({ ...draft(html), body_replyless: null })).toBe(
      html
    );
  });

  it('has nothing to seed without an HTML body', () => {
    expect(draftEditorHtml(draft(''))).toBeUndefined();
  });
});
