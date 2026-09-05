import { batch, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { createEmailFormState } from '../primitives/email-form-state';
import { createEmailInboxSource, type EmailInboxQuery } from './inbox-source';

it('keeps cached secondary-inbox reply semantics after a failed refresh and does not retain across accounts', () =>
  createRoot((dispose) => {
    try {
      const [owner, setOwner] = createSignal('me@example.com');
      const [status, setStatus] = createSignal('success');
      const data = {
        links: [
          {
            id: 'secondary',
            email_address: 'shared@example.com',
            settings: { signature: '<p>Shared signature</p>' },
          },
        ],
      };
      const query = {
        get isSuccess() {
          return status() === 'success';
        },
        get isError() {
          return status() === 'error';
        },
        get isPending() {
          return status() === 'pending';
        },
        get data() {
          if (status() === 'pending') throw new Error('suspending read');
          return data;
        },
      } as unknown as EmailInboxQuery;
      const source = createEmailInboxSource(owner, query, () => 'Shared Inbox');
      setStatus('error');
      const parent = message('parent', {
        link_id: 'secondary',
        from: { email: 'shared@example.com' },
        to: [{ email: 'colleague@example.com' }],
        is_sent: true,
      });
      const form = createEmailFormState(
        { viewerEmail: owner, inboxes: source.inboxes },
        { type: 'replying_to', messageID: 'parent' },
        {
          getMessageByID: () => parent,
          getDraftForMessageReply: () => undefined,
        }
      );
      expect(form.recipients().to.map((item) => item.data.email)).toEqual([
        'colleague@example.com',
      ]);
      expect(source.inboxes()[0].settings.signature).toContain(
        'Shared signature'
      );
      const reopened = createEmailInboxSource(
        owner,
        query,
        () => 'Shared Inbox'
      );
      expect(reopened.inboxes()[0].id).toBe('secondary');
      batch(() => {
        setOwner('other@example.com');
        setStatus('pending');
      });
      expect(source.inboxes()).toEqual([]);
    } finally {
      dispose();
    }
  }));
