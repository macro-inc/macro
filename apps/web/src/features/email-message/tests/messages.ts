import type { EmailMessage } from '../core/email-message';
export function message(
  id: string,
  overrides: Partial<EmailMessage> = {}
): EmailMessage {
  return {
    db_id: id,
    thread_db_id: 'thread',
    link_id: 'inbox',
    created_at: '2026-09-01T10:00:00Z',
    updated_at: '2026-09-01T10:00:00Z',
    internal_date_ts: '2026-09-01T10:00:00Z',
    from: { email: 'sender@example.com' },
    to: [{ email: 'viewer@example.com' }],
    cc: [],
    bcc: [],
    subject: 'Review',
    body_html_sanitized: '<p>Hello</p>',
    attachments: [],
    attachments_draft: [],
    attachments_forwarded: [],
    labels: [],
    is_draft: false,
    ...overrides,
  };
}
