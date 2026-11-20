import { findPrimaryEmailLinkId } from '@queries/email/link';
import { batch, createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import { createEmailFormState } from '../primitives/email-form-state';
import { createEmailInboxSource, type EmailInboxQuery } from './inbox-source';
import { queuedDraftSaveArgs } from './queued-draft';

it.each(['pending', 'error'])(
  'keeps the sending owner and primary inbox during a %s catalog refresh',
  (nextStatus) =>
    createRoot((dispose) => {
      try {
        const [owner, setOwner] = createSignal('me@example.com');
        const [status, setStatus] = createSignal('success');
        const [data, setData] = createSignal<EmailInboxQuery['data']>({
          links: [
            {
              id: 'delegated',
              email_address: 'shared@example.com',
              provider: 'OUTLOOK',
              photo_url: null,
              macro_id: 'macro|shared@example.com',
              is_primary: true,
              needs_reauth: false,
              draft_is_signal: false,
              sendAs: null,
              settings: {
                signature: '<p>Shared signature</p>',
                signature_on_replies_forwards: true,
              },
            },
            {
              id: 'own',
              email_address: 'me@example.com',
              provider: 'GMAIL',
              photo_url: null,
              macro_id: 'macro|me@example.com',
              is_primary: true,
              needs_reauth: false,
              draft_is_signal: true,
              sendAs: null,
              settings: {
                signature: '',
                signature_on_replies_forwards: false,
              },
            },
          ],
        });
        const source = createEmailInboxSource(
          owner,
          {
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
              if (status() !== 'success') throw new Error('suspending read');
              return data();
            },
          },
          () => undefined
        );
        setStatus(nextStatus);
        const save = () =>
          queuedDraftSaveArgs({
            draft: { subject: 'Saved during refresh' },
            handles: { draftId: 'draft', threadId: 'thread' },
            senderLinkId: 'delegated',
            senderAccount: source.inboxes()[0],
            senderEmail: 'shared@example.com',
          });
        expect(save()).toMatchObject({
          newThreadOwnerId: 'macro|shared@example.com',
          senderIsSignal: false,
        });
        expect(
          findPrimaryEmailLinkId(source.inboxes(), 'macro|me@example.com')
        ).toBe('own');

        setOwner('other@example.com');
        expect(source.inboxes()).toEqual([]);
        expect(save).toThrow('sending account is available');
        setStatus('success');
        expect(source.inboxes()).toHaveLength(2);
        setData({ links: [] });
        expect(source.inboxes()).toEqual([]);
      } finally {
        dispose();
      }
    })
);

it.each(['pending', 'error'])(
  'keeps cached replies but clears inboxes when the owner changes during %s',
  (nextStatus) =>
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
        const source = createEmailInboxSource(
          owner,
          query,
          () => 'Shared Inbox'
        );
        setStatus('error');
        const parent = message('parent', {
          link_id: 'secondary',
          from: { email: 'shared@example.com' },
          to: [{ email: 'colleague@example.com' }],
        });
        const form = createEmailFormState(
          { viewerEmail: owner, inboxes: source.inboxes },
          { type: 'replying_to', messageId: 'parent' },
          {
            getMessageById: () => parent,
            getDraftForMessageReply: () => undefined,
          }
        );
        expect(form.selectedInboxId()).toBe('secondary');
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
          setStatus(nextStatus);
        });
        expect(source.inboxes()).toEqual([]);
        setStatus('pending');
        setStatus('error');
        expect(source.inboxes()).toEqual([]);
      } finally {
        dispose();
      }
    })
);
