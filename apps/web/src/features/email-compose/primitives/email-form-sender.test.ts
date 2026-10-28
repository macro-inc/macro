import { createRoot, createSignal } from 'solid-js';
import { expect, it } from 'vitest';
import { message } from '../../email-message/tests/messages';
import type { SenderInbox } from '../core/email-sender';
import { createEmailFormState } from './email-form-state';

const primary: SenderInbox = { id: 'inbox', email_address: 'base@example.com' };
const loaded: SenderInbox = {
  ...primary,
  sendAs: [{ email_address: 'resident@example.com' }],
};
const parent = message('parent', {
  link_id: 'inbox',
  from: { email: 'customer@example.com' },
  to: [{ email: 'resident@example.com' }],
  cc: [{ email: 'BASE@example.com' }],
});

it('late aliases update the default without writing a draft or keeping self in reply-all', () =>
  createRoot((dispose) => {
    try {
      const [inboxes, setInboxes] = createSignal<SenderInbox[]>([primary]);
      const form = createEmailFormState(
        { viewerEmail: () => 'base@example.com', inboxes },
        { type: 'replying_to', messageId: 'parent' },
        {
          getMessageById: () => parent,
          getDraftForMessageReply: () => undefined,
        }
      );
      setInboxes([loaded]);
      expect(form.senderEmail()).toBe('resident@example.com');
      expect(form.recipients().to.map((item) => item.data.email)).toEqual([
        'customer@example.com',
      ]);
      expect(form.recipients().cc).toEqual([]);
      expect(form.editRevision()).toBe(0);
    } finally {
      dispose();
    }
  }));

it('a manual primary choice wins over late aliases and refetches', () =>
  createRoot((dispose) => {
    try {
      const [inboxes, setInboxes] = createSignal<SenderInbox[]>([primary]);
      const form = createEmailFormState(
        { viewerEmail: () => 'base@example.com', inboxes },
        { type: 'replying_to', messageId: 'parent' },
        {
          getMessageById: () => parent,
          getDraftForMessageReply: () => undefined,
        }
      );
      form.setSelectedInbox('inbox', 'base@example.com');
      setInboxes([loaded]);
      expect(form.senderEmail()).toBe('base@example.com');
      form.setSelectedInbox('inbox', 'resident@example.com');
      setInboxes([primary]);
      expect(form.senderEmail()).toBe('resident@example.com');
    } finally {
      dispose();
    }
  }));

it.each(['base@example.com', 'resident@example.com'])(
  'restores the saved sender %s without reselecting from recipients',
  (email) =>
    createRoot((dispose) => {
      try {
        const draft = message('draft', {
          ...parent,
          db_id: 'draft',
          is_draft: true,
          from: { email },
        });
        const form = createEmailFormState(
          { viewerEmail: () => 'base@example.com', inboxes: () => [loaded] },
          { type: 'replying_to', messageId: 'parent' },
          {
            getMessageById: () => parent,
            getDraftForMessageReply: () => draft,
          }
        );
        expect(form.senderEmail()).toBe(email);
      } finally {
        dispose();
      }
    })
);

it('preserves the alias sender when forwarding and retains only attachments not linked in the quote', () =>
  createRoot((dispose) => {
    try {
      const original = message('parent', {
        ...parent,
        body_html_sanitized: '<img src="cid:logo"><img src="cid:chart">',
        attachments: [
          {
            db_id: 'logo',
            mime_type: 'image/png',
            content_id: '<logo>',
            sfs_id: 'logo-file',
          },
          { db_id: 'chart', mime_type: 'image/png', content_id: '<chart>' },
          { db_id: 'report', mime_type: 'application/pdf' },
        ],
      });
      const form = createEmailFormState(
        { viewerEmail: () => 'base@example.com', inboxes: () => [loaded] },
        { type: 'replying_to', messageId: 'parent' },
        {
          getMessageById: () => original,
          getDraftForMessageReply: () => undefined,
        }
      );
      form.setReplyType('forward');
      expect(form.senderEmail()).toBe('resident@example.com');
      expect(
        form.attachments.list().map((attachment) => attachment.attachmentId)
      ).toEqual(['chart', 'report']);
      expect(form.recipients()).toEqual({ to: [], cc: [], bcc: [] });
    } finally {
      dispose();
    }
  }));

it('does not pick an alias belonging only to another connected inbox', () =>
  createRoot((dispose) => {
    try {
      const form = createEmailFormState(
        {
          viewerEmail: () => 'base@example.com',
          inboxes: () => [primary, { ...loaded, id: 'other' }],
        },
        { type: 'replying_to', messageId: 'parent' },
        {
          getMessageById: () => parent,
          getDraftForMessageReply: () => undefined,
        }
      );
      expect(form.senderEmail()).toBe('base@example.com');
    } finally {
      dispose();
    }
  }));

it.each(['base@example.com', 'resident@example.com'])(
  'restores sender %s and edited recipients into a new reply after cancellation',
  (email) =>
    createRoot((dispose) => {
      try {
        const [inboxes, setInboxes] = createSignal<SenderInbox[]>([loaded]);
        const form = createEmailFormState(
          { viewerEmail: () => 'base@example.com', inboxes },
          { type: 'replying_to', messageId: 'parent' },
          {
            getMessageById: () => parent,
            getDraftForMessageReply: () => undefined,
          }
        );
        form.setSelectedInbox(
          'inbox',
          email === 'base@example.com'
            ? 'resident@example.com'
            : 'base@example.com'
        );
        form.clear();
        const revision = form.editRevision();
        form.restoreDraft(
          message('restored', {
            is_draft: true,
            link_id: 'inbox',
            from: { email },
            to: [{ email: 'edited@example.com' }],
            cc: [{ email: 'reviewer@example.com' }],
            bcc: [{ email: 'private@example.com' }],
            body_html_sanitized: null,
          })
        );
        // Catalog refreshes must not re-derive explicit restored choices.
        setInboxes([primary]);
        setInboxes([loaded]);
        expect(form.senderEmail()).toBe(email);
        expect(form.recipients().to.map((item) => item.data.email)).toEqual([
          'edited@example.com',
        ]);
        expect(form.recipients().cc.map((item) => item.data.email)).toEqual([
          'reviewer@example.com',
        ]);
        expect(form.recipients().bcc.map((item) => item.data.email)).toEqual([
          'private@example.com',
        ]);
        expect(form.editRevision()).toBe(revision);
      } finally {
        dispose();
      }
    })
);
