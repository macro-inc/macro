import { createRoot } from 'solid-js';
import { describe, expect, it } from 'vitest';
import type { EmailMessage } from '../../email-message/core/email-message';
import { createEmailFormState } from './email-form-state';

describe('reply recipients across inboxes', () => {
  it('uses the thread inbox instead of the viewer address when replying to a sent message', () =>
    createRoot((dispose) => {
      try {
        const parent: EmailMessage = {
          db_id: 'message',
          thread_db_id: 'thread',
          link_id: 'secondary',
          from: { email: 'secondary@example.com' },
          to: [{ email: 'colleague@example.com' }],
          cc: [],
          bcc: [],
          created_at: '',
          updated_at: '',
          subject: 'Review',
          labels: [],
          attachments: [],
          attachments_draft: [],
          attachments_forwarded: [],
          is_read: true,
          is_sent: true,
          is_draft: false,
          is_starred: false,
          has_attachments: false,
        };
        const form = createEmailFormState(
          {
            viewerEmail: () => 'primary@example.com',
            inboxes: () => [
              { id: 'secondary', email_address: 'secondary@example.com' },
            ],
          },
          { type: 'replying_to', messageID: parent.db_id },
          {
            getMessageByID: () => parent,
            getDraftForMessageReply: () => undefined,
          }
        );
        expect(form.selectedLinkId()).toBe('secondary');
        expect(
          form.recipients().to.map((recipient) => recipient.data.email)
        ).toEqual(['colleague@example.com']);
        expect(
          form
            .recipients()
            .to.some(
              (recipient) => recipient.data.email === 'secondary@example.com'
            )
        ).toBe(false);
      } finally {
        dispose();
      }
    }));
});
