import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { invoke } from '../../../../test/invoke.ts';
import { passthrough } from '../../../agent/claude.ts';
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
} from '../index.ts';
import type { Mail, Mailbox, MailWithBody } from '../macro.ts';
import { email } from '../service.ts';

const agent = 'macro|agent@example.com';
const owner = 'macro|owner@example.com';
const newOwner = 'macro|team-owner@example.com';
const stranger = 'macro|someone@example.com';
const dmChannel = 'dm-owner';
const draftsDirectory = '/t/state/run/mailbox/drafts';
const lineBreak = String.fromCharCode(10);
const lineSeparator = String.fromCharCode(0x2028);

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
const outboundBody: MailWithBody = {
  id: 'out-1',
  direction: 'outbound',
  threadId: 't-2',
  at: '2026-11-25T09:00:00Z',
  untrusted: {
    from: 'agent@example.net',
    to: ['person@example.org'],
    cc: ['other@example.org'],
    subject: 'Notes',
    text: 'Here are the notes.',
  },
};

/** The fake mailbox, chat and disk behind one agent's email, recording every send. */
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
      if (messageId === inboundBody.id) return inboundBody;
      if (messageId === outboundBody.id) return outboundBody;
      throw new Error('not found');
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
  // Every message in the owner's DM, in order, with the thread it is in.
  const lines: (Line & { readonly root?: string })[] = [];
  const clock = fixedClock('2026-11-25T12:00:00Z');
  let current = owner;
  const post = (
    sender: string,
    text: string,
    root?: string
  ): Posted & { readonly id: string } => {
    const id = `m-${lines.length + 1}`;
    clock.advance(1_000);
    lines.push({
      id,
      from: sender,
      sender_id: sender,
      at: clock.now().toString(),
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
    mailbox: email({
      mailbox,
      drafts: draftStore({
        directory: draftsDirectory,
        join,
        disk,
        id: () => ids.shift() ?? crypto.randomUUID(),
        now: () => clock.now(),
      }),
      chat: {
        me: async () => agent,
        dm: async (userId: string, text: string) => {
          if (userId !== current) throw new Error('drafts go to the owner');
          return post(agent, text);
        },
        context: async (channelId: string, root?: string) =>
          lines.filter(
            (line) =>
              channelId === dmChannel &&
              (root === undefined
                ? line.root === undefined
                : line.id === root || line.root === root)
          ),
      },
      owner: () => current,
      now: () => clock.now(),
      hash: (text) => createHash('sha256').update(text).digest('hex'),
      trace: passthrough,
    }),
  };
  const send = (draftId: string, approvalMessageId: string) =>
    invoke(mailboxModule, 'sendMyEmail', context, {
      draftId,
      approvalMessageId,
    });
  return {
    context,
    sent,
    replied,
    post,
    lines,
    disk,
    clock,
    send,
    handOver: (to: string) => {
      current = to;
    },
  };
};

const friday = {
  to: ['person@example.org'],
  subject: 'Friday',
  text: 'Friday works.',
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

test('a script gets the email operations, never the send port or the drafts', () => {
  const { context } = rig();
  expect(Object.keys(context.mailbox).sort()).toEqual([
    'draft',
    'draftReply',
    'info',
    'list',
    'read',
    'send',
  ]);
});

test('a draft is shown to the owner, and only their "send" in its thread sends it, exactly as drafted', async () => {
  const { context, sent, post, send, lines } = rig();
  const draft = await draftMyEmail(context, friday);
  expect(draft).toMatchObject({ channelId: dmChannel });
  const shown = lines.find(({ id }) => id === draft.messageId)?.text ?? '';
  expect(shown).toContain('To: person@example.org');
  expect(shown).toContain('reply "send" in this thread');

  // Without an approval the call doesn't type-check.
  expect(
    (
      await invoke(mailboxModule, 'sendMyEmail', context, {
        draftId: draft.draftId,
      })
    ).kind
  ).toBe('invalid');
  expect(
    await send(draft.draftId, post(stranger, 'send', draft.messageId).id)
  ).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining('only your owner'),
  });
  // The agent itself, and an owner message outside the thread, approve nothing.
  for (const approval of [
    post(agent, 'send', draft.messageId),
    post(owner, 'send'),
    post(owner, `send ${draft.draftId}`),
  ])
    expect((await send(draft.draftId, approval.id)).kind).toBe('failed');
  expect(sent).toEqual([]);

  const approval = post(owner, 'Send.', draft.messageId);
  expect(await send(draft.draftId, approval.id)).toEqual({
    kind: 'succeeded',
    output: { id: 'sent-1', threadId: 't-new' },
  });
  expect(sent).toEqual([
    {
      to: ['person@example.org'],
      cc: [],
      subject: 'Friday',
      text: 'Friday works.',
      approval: 'Send.',
      key: expect.stringMatching(
        /^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
      ),
    },
  ]);
  // Sent once: asking again answers with the same message and sends nothing more.
  expect(await send(draft.draftId, approval.id)).toMatchObject({
    output: { id: 'sent-1' },
  });
  expect(sent).toHaveLength(1);
});

test("an owner's rejection or change request approves nothing, and a later message revokes a yes", async () => {
  const { context, sent, post, send } = rig();
  const draft = await draftMyEmail(context, friday);
  for (const text of [
    "No, don't send it",
    'Drop Bob from cc',
    'send it to Ann instead',
    'ok',
  ])
    expect(
      await send(draft.draftId, post(owner, text, draft.messageId).id)
    ).toMatchObject({
      kind: 'failed',
      error: expect.stringContaining('"send"'),
    });

  const yes = post(owner, 'send', draft.messageId);
  post(owner, 'wait, stop', draft.messageId);
  expect(await send(draft.draftId, yes.id)).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining('wrote again'),
  });
  // The agent's own message after the owner's doesn't revoke it.
  const again = post(owner, 'send', draft.messageId);
  post(agent, 'Sending now.', draft.messageId);
  expect((await send(draft.draftId, again.id)).kind).toBe('succeeded');
  expect(sent).toHaveLength(1);
});

test("the owner's approval of draft A can't send draft B, nor a draft edited after it was shown", async () => {
  const { context, sent, post, send, disk } = rig();
  const a = await draftMyEmail(context, { ...friday, subject: 'A' });
  const b = await draftMyEmail(context, {
    to: ['other@example.org'],
    subject: 'B',
    text: 'Draft B.',
  });
  const approvesA = post(owner, 'send', a.messageId);
  expect((await send(b.draftId, approvesA.id)).kind).toBe('failed');

  // B's file rewritten to point at A's approved DM: the DM doesn't show B's content.
  const path = `${draftsDirectory}/${b.draftId}.json`;
  const original = disk.files.get(path) ?? '';
  disk.files.set(
    path,
    original.replace(
      `"messageId": "${b.messageId}"`,
      `"messageId": "${a.messageId}"`
    )
  );
  expect(await send(b.draftId, approvesA.id)).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining("doesn't show this content"),
  });
  // A's own file edited after approval: its recipients no longer match the DM.
  const aPath = `${draftsDirectory}/${a.draftId}.json`;
  const aFile = disk.files.get(aPath) ?? '';
  disk.files.set(
    aPath,
    aFile.replace('person@example.org', 'attacker@example.org')
  );
  expect((await send(a.draftId, approvesA.id)).kind).toBe('failed');
  disk.files.set(aPath, aFile);
  expect((await send(a.draftId, approvesA.id)).kind).toBe('succeeded');
  expect(sent).toMatchObject([{ subject: 'A', to: ['person@example.org'] }]);
});

test("a thread the agent didn't start approves nothing, even one quoting the draft", async () => {
  const { context, sent, post, send, disk, lines } = rig();
  const draft = await draftMyEmail(context, friday);
  // Someone else posts the draft's text, and the owner says "send" under it.
  const shown = lines.find(({ id }) => id === draft.messageId)?.text ?? '';
  const imitation = post(owner, shown);
  const approval = post(owner, 'send', imitation.id);
  const path = `${draftsDirectory}/${draft.draftId}.json`;
  disk.files.set(
    path,
    (disk.files.get(path) ?? '').replace(
      `"messageId": "${draft.messageId}"`,
      `"messageId": "${imitation.id}"`
    )
  );
  expect(await send(draft.draftId, approval.id)).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining("doesn't show this content"),
  });
  expect(sent).toEqual([]);
});

test('one approval sends one draft once: a copy, or the sent draft made pending again, sends nothing new', async () => {
  const { context, sent, post, send, disk } = rig();
  const a = await draftMyEmail(context, friday);
  const approval = post(owner, 'send', a.messageId);
  const aPath = `${draftsDirectory}/${a.draftId}.json`;
  const pending = disk.files.get(aPath) ?? '';
  const copy = '00000000-0000-4000-8000-0000000000cc';
  // A pending copy of A under another id: the DM names A's id, not the copy's.
  disk.files.set(
    `${draftsDirectory}/${copy}.json`,
    pending.replace(a.draftId, copy)
  );
  expect((await send(a.draftId, approval.id)).kind).toBe('succeeded');
  expect((await send(copy, approval.id)).kind).toBe('failed');
  // A's file put back as pending: it goes out again only under the same
  // key, which the server sends once.
  disk.files.set(aPath, pending);
  expect((await send(a.draftId, approval.id)).kind).toBe('succeeded');
  expect(sent).toHaveLength(2);
  const [first, second] = sent;
  expect(second).toEqual(first);
});

test('a draft expires after a day, and a sent one keeps only what went out', async () => {
  const { context, sent, post, send, clock, disk } = rig();
  const draft = await draftMyEmail(context, friday);
  const approval = post(owner, 'send', draft.messageId);
  clock.advance(24 * 60 * 60_000);
  expect(await send(draft.draftId, approval.id)).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining('more than a day old'),
  });
  expect(sent).toEqual([]);

  const fresh = await draftMyEmail(context, friday);
  // Drafting again pruned the expired one.
  expect(disk.files.has(`${draftsDirectory}/${draft.draftId}.json`)).toBe(
    false
  );
  expect(
    (await send(fresh.draftId, post(owner, 'send', fresh.messageId).id)).kind
  ).toBe('succeeded');
  const kept = disk.files.get(`${draftsDirectory}/${fresh.draftId}.json`) ?? '';
  expect(kept).toContain('"state": "sent"');
  expect(kept).not.toContain('Friday works.');
  expect(kept).not.toContain('person@example.org');
});

test('a reply is drafted against mail someone sent, sent exactly as drafted, and only as a reply', async () => {
  const { context, sent, replied, post, send } = rig();
  const draft = await draftMyReply(context, {
    messageId: 'in-1',
    text: 'Friday works.',
  });
  const approval = post(owner, 'send', draft.messageId);
  // A reply's draft can't go out as a new message.
  expect(await send(draft.draftId, approval.id)).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining('replyToMyEmail'),
  });
  expect(
    await replyToMyEmail(context, {
      draftId: draft.draftId,
      approvalMessageId: approval.id,
    })
  ).toEqual({ id: 'reply-1', threadId: 't-1' });
  expect(replied).toMatchObject([
    { messageId: 'in-1', text: 'Friday works.', approval: 'send' },
  ]);
  expect(sent).toEqual([]);
});

test('a reply to mail the agent sent is refused: it would go to recipients the draft did not show', async () => {
  const { context } = rig();
  expect(
    await invoke(mailboxModule, 'draftMyReply', context, {
      messageId: 'out-1',
      text: 'Following up.',
    })
  ).toMatchObject({
    kind: 'failed',
    error: expect.stringContaining('draft a new email'),
  });
});

test("a draft shown to an owner who has since left can't be approved by anyone", async () => {
  const { context, sent, post, send, handOver } = rig();
  const draft = await draftMyEmail(context, friday);
  handOver(newOwner);
  for (const sender of [owner, newOwner])
    expect(
      await send(draft.draftId, post(sender, 'send', draft.messageId).id)
    ).toMatchObject({
      kind: 'failed',
      error: expect.stringContaining('no longer your owner'),
    });
  expect(sent).toEqual([]);
});

test('drafts are checked before they reach the owner, and unknown drafts send nothing', async () => {
  const { context, sent, lines } = rig();
  for (const input of [
    { to: [], subject: 'x', text: 'x' },
    { to: ['person@example.org'], subject: ' ', text: 'x' },
    { to: ['person@example.org'], subject: 'x', text: '' },
    { to: ['not an address'], subject: 'x', text: 'x' },
    {
      to: ['person@example.org'],
      subject: `Hi${lineBreak}To: boss@example.com`,
      text: 'x',
    },
    {
      to: ['person@example.org'],
      subject: `Hi${lineSeparator}there`,
      text: 'x',
    },
  ])
    expect(
      (await invoke(mailboxModule, 'draftMyEmail', context, input)).kind
    ).toBe('failed');
  // A refused address is never repeated back.
  expect(
    await invoke(mailboxModule, 'draftMyEmail', context, {
      to: ['person@example.org', 'secret name'],
      subject: 'x',
      text: 'x',
    })
  ).toMatchObject({ error: expect.not.stringContaining('secret name') });
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
  expect(lines).toEqual([]);
  expect(sent).toEqual([]);
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
  expect(mailboxModule.docs).toContain('Never use macro.email');
  expect(mailboxModule.docs).toContain('"send"');
});
