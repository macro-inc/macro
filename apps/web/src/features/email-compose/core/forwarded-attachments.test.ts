import type { EmailAttachment } from '@app/features/email-message/core/email-message';
import { describe, expect, it } from 'vitest';
import { forwardedAttachments } from './forwarded-attachments';

function attachment(
  db_id: string,
  overrides: Partial<EmailAttachment> = {}
): EmailAttachment {
  return { db_id, mime_type: 'image/png', ...overrides };
}

describe('forwardedAttachments', () => {
  it('excludes Outlook cloud references while retaining binary attachments', () => {
    const forwarded = forwardedAttachments({
      attachments: [
        attachment('cloud', { reference_url: 'https://example.com/shared' }),
        attachment('binary'),
      ],
    });
    expect(forwarded.map((a) => a.db_id)).toEqual(['binary']);
  });

  it('leaves out inline images the quoted body links to their static-file copy', () => {
    const forwarded = forwardedAttachments({
      body_html_sanitized: '<img src="cid:logo"><img src="cid:chart">',
      attachments: [
        attachment('logo', { content_id: '<logo>', sfs_id: 'logo-file' }),
        attachment('chart', { content_id: 'chart', sfs_id: 'chart-file' }),
        attachment('report', { mime_type: 'application/pdf' }),
      ],
    });
    expect(forwarded.map((a) => a.db_id)).toEqual(['report']);
  });

  it('attaches an inline image without a static-file copy so it is not lost', () => {
    const forwarded = forwardedAttachments({
      body_html_sanitized: '<img src="cid:logo">',
      attachments: [attachment('logo', { content_id: '<logo>' })],
    });
    expect(forwarded.map((a) => a.db_id)).toEqual(['logo']);
  });

  it('ignores cid: values outside an image source', () => {
    const forwarded = forwardedAttachments({
      body_html_sanitized:
        '<img data-src="cid:logo" src="https://example.com/logo.png"><div xsrc="cid:logo"></div>',
      attachments: [
        attachment('logo', { content_id: '<logo>', sfs_id: 'logo-file' }),
      ],
    });
    expect(forwarded.map((a) => a.db_id)).toEqual(['logo']);
  });

  it('attaches a file whose Content-ID the body never shows inline', () => {
    const forwarded = forwardedAttachments({
      body_html_sanitized: '<p>See attached</p>',
      attachments: [
        attachment('photo', { content_id: '<photo>', sfs_id: 'photo-file' }),
      ],
    });
    expect(forwarded.map((a) => a.db_id)).toEqual(['photo']);
  });
});
