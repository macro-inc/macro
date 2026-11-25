import { expect, test } from 'bun:test';
import { invoke } from '../../../../test/invoke.ts';
import { fixedClock, join, memoryDisk } from '../../../context/test/fakes.ts';
import type { Line, Posted } from '../../chat/macro.ts';
import { draftStore } from '../drafts.ts';
import {
  draftMyEmail,
  draftMyReply,
  listMyEmail,
  mailboxModule,
  myEmailAddress,
  readMyEmail,
  replyToMyEmail,
  sendMyEmail,
} from '../index.ts';
import type { Mail, Mailbox } from '../macro.ts';

const owner = 'macro|owner@example.com';
const stranger = 'macro|someone@example.com';
const dmChannel = 'dm-owner';

const inbound: Mail = {
  id: 'in-1',
  from: 'person@example.org',
  to: ['agent@example.net'],
  cc: [],
  subject: 'Lunch?',
  direction: 'inbound',
};

type Sends = {
  readonly sent: unknown[];
  readonly replied: unknown[];
};

/** A fake mailbox that records every send and reply, and a fake chat for the drafts' DMs. */
const rig = () => {
  const record: Sends = { sent: [], replied: [] };
  const mailbox: Mailbox = {
    info: async () => ({
      address: 'agent@example.net',
      state: 'active',
      notice: 'fake vendor, not live',
    }),
    list: async () => ({ messages: [inbound], nextCursor: undefined }),
    read: async (messageId) => {
      if (messageId !== inbound.id) throw new Error('not found');
      return {
        ...inbound,
        threadId: 't-1',
        at: '2026-11-25T10:00:00Z',
        text: 'Free on Friday?',
      };
    },
    send: async (message) => {
      record.sent.push(message);
      return { id: `sent-${record.sent.length}`, threadId: 't-new' };
    },
    reply: async (messageId, message) => {
      record.replied.push({ messageId, ...message });
      return { id: `reply-${record.replied.length}`, threadId: 't-1' };
    },
  };
  // Every message in the owner's DM, in order, with the thread it is in.
  const lines: (Line & { readonly root?: string })[] = [];
  let posted = 0;
  const post = (
    sender: string,
    text: string,
    root?: string
  ): Posted & { readonly id: string } => {
    posted += 1;
    const id = `m-${posted}`;
    lines.push({
      id,
      from: sender,
      sender_id: sender,
      at: `2026-11-25T12:00:${String(posted).padStart(2, '0')}Z`,
      text,
      root,
    });
    return { channelId: dmChannel, messageId: id, id };
  };
  const ids = [
    '00000000-0000-4000-8000-00000000000a',
    '00000000-0000-4000-8000-00000000000b',
  ];
  const disk = memoryDisk();
  const context = {
    mailbox,
    drafts: draftStore({
      directory: '/t/state/run/mailbox/drafts',
      join,
      disk,
      id: () => ids.shift() ?? crypto.randomUUID(),
    }),
    chat: {
      dm: async (userId: string, text: string) => {
        if (userId !== owner) throw new Error('drafts go to the owner');
        return post('macro|agent@example.com', text);
      },
      context: async (channelId: string, root?: string) =>
        lines.filter(
          (line) =>
            channelId === dmChannel &&
            (root === undefined
              ? line.root === undefined
              : line.id === root || line.root === root)
        ),
      since: async (channelId: string, since: string) =>
        lines.filter(
          (line) =>
            channelId === dmChannel &&
            Temporal.Instant.compare(
              Temporal.Instant.from(line.at),
              Temporal.Instant.from(since)
            ) >= 0
        ),
    },
    config: { owner },
    clock: fixedClock('2026-11-25T12:00:00Z'),
  };
  return { context, record, post };
};

test('the mailbox reads only the agent’s own mailbox: its address, a page, one message', async () => {
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
    subject: 'Lunch?',
    text: 'Free on Friday?',
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

test('a draft goes to the owner, and a send needs their reply to that draft', async () => {
  const { context, record, post } = rig();
  const draft = await draftMyEmail(context, {
    to: ['person@example.org'],
    subject: 'Friday',
    text: 'Friday works.',
  });
  expect(draft).toMatchObject({ channelId: dmChannel });

  // Without an approval the call doesn't type-check, and with none of the owner's nothing goes out.
  expect(
    (
      await invoke(mailboxModule, 'sendMyEmail', context, {
        draftId: draft.draftId,
      })
    ).kind
  ).toBe('invalid');
  const strangers = post(stranger, 'send it', draft.messageId);
  expect(
    await invoke(mailboxModule, 'sendMyEmail', context, {
      draftId: draft.draftId,
      approvalMessageId: strangers.id,
    })
  ).toMatchObject({ kind: 'failed', error: expect.stringContaining('owner') });
  // An owner message that answers nothing approves nothing.
  const unrelated = post(owner, 'yes, send it');
  expect(
    await invoke(mailboxModule, 'sendMyEmail', context, {
      draftId: draft.draftId,
      approvalMessageId: unrelated.id,
    })
  ).toMatchObject({ kind: 'failed' });
  expect(record.sent).toEqual([]);

  const approval = post(owner, 'Looks good, send it.', draft.messageId);
  expect(
    await sendMyEmail(context, {
      draftId: draft.draftId,
      approvalMessageId: approval.id,
    })
  ).toEqual({ id: 'sent-1', threadId: 't-new' });
  expect(record.sent).toEqual([
    {
      to: ['person@example.org'],
      cc: [],
      subject: 'Friday',
      text: 'Friday works.',
      approval: 'Looks good, send it.',
      key: draft.draftId,
    },
  ]);
  // Sent once: asking again answers with the same message and sends nothing more.
  expect(
    await sendMyEmail(context, {
      draftId: draft.draftId,
      approvalMessageId: approval.id,
    })
  ).toEqual({ id: 'sent-1', threadId: 't-new' });
  expect(record.sent).toHaveLength(1);
});

test('the owner’s approval of draft A can’t send draft B', async () => {
  const { context, record, post } = rig();
  const a = await draftMyEmail(context, {
    to: ['person@example.org'],
    subject: 'A',
    text: 'Draft A.',
  });
  const b = await draftMyEmail(context, {
    to: ['other@example.org'],
    subject: 'B',
    text: 'Draft B.',
  });
  const approvesA = post(owner, 'Yes, send that one.', a.messageId);
  const quotesA = post(owner, `Send ${a.draftId}`);
  for (const approvalMessageId of [approvesA.id, quotesA.id])
    expect(
      await invoke(mailboxModule, 'sendMyEmail', context, {
        draftId: b.draftId,
        approvalMessageId,
      })
    ).toMatchObject({ kind: 'failed' });
  expect(record.sent).toEqual([]);

  // A message in the DM that quotes the draft's id approves that draft.
  expect(
    await sendMyEmail(context, {
      draftId: a.draftId,
      approvalMessageId: quotesA.id,
    })
  ).toMatchObject({ id: 'sent-1' });
  expect(record.sent).toMatchObject([
    { subject: 'A', approval: `Send ${a.draftId}` },
  ]);
});

test('a reply is drafted against a message, sent exactly as drafted, and only as a reply', async () => {
  const { context, record, post } = rig();
  const draft = await draftMyReply(context, {
    messageId: 'in-1',
    text: 'Friday works.',
  });
  const approval = post(owner, 'ok', draft.messageId);
  // A reply's draft can't go out as a new message, nor a new message's as a reply.
  expect(
    await invoke(mailboxModule, 'sendMyEmail', context, {
      draftId: draft.draftId,
      approvalMessageId: approval.id,
    })
  ).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining('replyToMyEmail'),
  });
  expect(
    await replyToMyEmail(context, {
      draftId: draft.draftId,
      approvalMessageId: approval.id,
    })
  ).toEqual({ id: 'reply-1', threadId: 't-1' });
  expect(record.replied).toEqual([
    {
      messageId: 'in-1',
      text: 'Friday works.',
      approval: 'ok',
      key: draft.draftId,
    },
  ]);
  expect(record.sent).toEqual([]);
});

test('drafts are checked before they reach the owner, and unknown drafts send nothing', async () => {
  const { context, record } = rig();
  for (const input of [
    { to: [], subject: 'x', text: 'x' },
    { to: ['person@example.org'], subject: ' ', text: 'x' },
    { to: ['person@example.org'], subject: 'x', text: '' },
    { to: ['not an address'], subject: 'x', text: 'x' },
  ])
    expect(
      (await invoke(mailboxModule, 'draftMyEmail', context, input)).kind
    ).toBe('failed');
  for (const draftId of [
    '../../memory/x',
    '00000000-0000-4000-8000-000000000999',
  ])
    expect(
      (
        await invoke(mailboxModule, 'sendMyEmail', context, {
          draftId,
          approvalMessageId: 'm-1',
        })
      ).kind
    ).toBe('failed');
  expect(record.sent).toEqual([]);
});

test('the module tells the agent that its email is this mailbox, and never a connected inbox', () => {
  expect(mailboxModule.name).toBe('mailbox');
  expect(Object.keys(mailboxModule.functions).sort()).toEqual([
    'draftMyEmail',
    'draftMyReply',
    'listMyEmail',
    'myEmailAddress',
    'readMyEmail',
    'replyToMyEmail',
    'sendMyEmail',
  ]);
  expect(mailboxModule.summary).toMatch(/your (own )?email/i);
  expect(mailboxModule.docs).toContain('macro.email');
  expect(mailboxModule.docs).toMatch(/never/i);
});
