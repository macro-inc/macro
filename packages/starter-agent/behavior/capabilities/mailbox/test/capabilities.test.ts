import { expect, test } from 'bun:test';
import { invoke } from '../../../../test/invoke.ts';
import {
  listMyEmail,
  mailboxModule,
  myEmailAddress,
  readMyEmail,
  replyToMyEmail,
  sendMyEmail,
} from '../index.ts';
import type { Mail, Mailbox, MailWithBody } from '../macro.ts';

const inbound: Mail = {
  id: 'in-1',
  direction: 'inbound',
  untrusted: {
    from: 'person@example.org',
    to: ['agent@example.net'],
    cc: [],
    subject: 'Lunch?',
  },
};
const inboundBody: MailWithBody = {
  id: 'in-1',
  direction: 'inbound',
  threadId: 't-1',
  at: '2026-11-25T10:00:00Z',
  untrusted: { ...inbound.untrusted, text: 'Free on Friday?' },
};

/** A fake mailbox that records every send and reply. */
const rig = () => {
  const sent: unknown[] = [];
  const replied: unknown[] = [];
  const mailbox: Mailbox = {
    info: async () => ({
      address: 'agent@example.net',
      state: 'active',
      notice: 'fake vendor, not live',
    }),
    list: async () => ({ messages: [inbound], nextCursor: undefined }),
    read: async (messageId) => {
      if (messageId !== inboundBody.id) throw new Error('not found');
      return inboundBody;
    },
    send: async (message) => {
      sent.push(message);
      return { id: `sent-${sent.length}`, threadId: 't-new' };
    },
    reply: async (messageId, message) => {
      replied.push({ messageId, ...message });
      return { id: `reply-${replied.length}`, threadId: 't-1' };
    },
  };
  return { context: { mailbox }, sent, replied };
};

test("the mailbox reads only the agent's own mailbox, with what senders claim kept apart", async () => {
  const { context } = rig();
  expect(await myEmailAddress(context)).toEqual({
    address: 'agent@example.net',
    state: 'active',
    notice: 'fake vendor, not live',
  });
  expect(await invoke(mailboxModule, 'listMyEmail', context)).toEqual({
    kind: 'succeeded',
    output: { messages: [inbound], nextCursor: undefined },
  });
  expect(await listMyEmail(context, { limit: 5 })).toMatchObject({
    messages: [{ id: 'in-1' }],
  });
  expect(await readMyEmail(context, { messageId: 'in-1' })).toMatchObject({
    untrusted: { subject: 'Lunch?', text: 'Free on Friday?' },
  });
  // No function takes a mailbox, an address to read, or an account.
  expect(
    (
      await invoke(mailboxModule, 'listMyEmail', context, {
        mailbox: 'owner@example.com',
      })
    ).kind
  ).toBe('invalid');
});

test('an email and a reply go out at once, each under its purpose', async () => {
  const { context, sent, replied } = rig();
  expect(
    await sendMyEmail(context, {
      to: ['person@example.org'],
      subject: 'Friday',
      text: 'Friday works.',
      purpose: 'task t-1: confirm Friday',
    })
  ).toEqual({ id: 'sent-1', threadId: 't-new' });
  expect(
    await replyToMyEmail(context, {
      messageId: 'in-1',
      text: 'Yes, Friday.',
      purpose: 'reply to in-1',
    })
  ).toEqual({ id: 'reply-1', threadId: 't-1' });
  expect(sent).toEqual([
    {
      to: ['person@example.org'],
      cc: [],
      subject: 'Friday',
      text: 'Friday works.',
      purpose: 'task t-1: confirm Friday',
    },
  ]);
  expect(replied).toEqual([
    {
      messageId: 'in-1',
      text: 'Yes, Friday.',
      purpose: 'reply to in-1',
    },
  ]);
});

test('a send without recipients, text or purpose goes nowhere, and never repeats an address', async () => {
  const { context, sent } = rig();
  const friday = {
    to: ['person@example.org'],
    subject: 'Friday',
    text: 'Friday works.',
    purpose: 'task t-1',
  };
  for (const input of [
    { ...friday, to: [] },
    { ...friday, to: ['not an address'] },
    { ...friday, subject: ' ' },
    { ...friday, text: '' },
    { ...friday, purpose: '' },
  ])
    expect(
      (await invoke(mailboxModule, 'sendMyEmail', context, input)).kind
    ).toBe('failed');
  expect(
    (
      await invoke(mailboxModule, 'sendMyEmail', context, {
        ...friday,
        purpose: undefined,
      })
    ).kind
  ).toBe('invalid');
  expect(
    await invoke(mailboxModule, 'sendMyEmail', context, {
      ...friday,
      to: ['person@example.org', 'secret name'],
    })
  ).toMatchObject({ error: expect.not.stringContaining('secret name') });
  expect(sent).toEqual([]);
});

test('the module tells the agent that its email is this mailbox, and never a connected inbox', () => {
  expect(mailboxModule.name).toBe('mailbox');
  expect(Object.keys(mailboxModule.functions).sort()).toEqual([
    'listMyEmail',
    'myEmailAddress',
    'readMyEmail',
    'replyToMyEmail',
    'sendMyEmail',
  ]);
  expect(mailboxModule.summary).toMatch(/your (own )?email/i);
  expect(mailboxModule.docs).toContain('Never use macro.email');
});
