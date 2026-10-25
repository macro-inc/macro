import { createSignal } from 'solid-js';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { EmailContact } from '../../email-message/core/email-message';
import { message } from '../../email-message/tests/messages';
import type { EmailInbox } from '../context/compose-capabilities';
import type { ReplyType } from '../core/reply-type';
import { createComposeContext } from '../tests/capabilities';
import { mountReplyComposer } from '../tests/reply';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const bounceSenders = [
  {
    provider: 'GMAIL',
    from: {
      name: 'Mail Delivery Subsystem',
      email: 'mailer-daemon@googlemail.com',
    },
  },
  {
    provider: 'OUTLOOK',
    from: {
      name: 'Microsoft Outlook',
      email:
        'MicrosoftExchange329e71ec88ae4615bbc36ab6ce41109e@macro420.onmicrosoft.com',
    },
  },
] as const satisfies {
  provider: EmailInbox['provider'];
  from: EmailContact;
}[];

/** Presses the message card's Reply, which asks for reply-all, and sends. */
async function sendReply(
  provider: EmailInbox['provider'],
  from: EmailContact,
  to: EmailContact[]
) {
  const context = createComposeContext();
  context.accounts.inboxes = () => [
    { id: 'inbox', email_address: 'me@example.com', provider, settings: {} },
  ];
  const [replyType, setReplyType] = createSignal<ReplyType>();
  const reply = mountReplyComposer(
    context,
    () => message('parent', { from, to, subject: 'Numbers' }),
    {},
    { replyRequest: { replyType, clear: () => setReplyType(undefined) } }
  );
  try {
    setReplyType('reply-all');
    await vi.advanceTimersByTimeAsync(0);
    await reply.sendEmail();
    return vi
      .mocked(context.delivery.sendMessage)
      .mock.calls.map(([sent]) => sent.message.to?.map((c) => c.email));
  } finally {
    reply.dispose();
  }
}

it.each(bounceSenders)(
  'replies to the people on a $provider thread but not its bounce sender',
  async ({ provider, from }) => {
    const participants = [
      { email: 'me@example.com' },
      { email: 'teammate@example.com' },
    ];

    expect(await sendReply(provider, from, participants)).toEqual([
      ['teammate@example.com'],
    ]);
    expect(
      await sendReply(
        provider,
        { name: 'Vendor Billing', email: 'noreply@vendor.com' },
        participants
      )
    ).toEqual([['noreply@vendor.com', 'teammate@example.com']]);
  }
);

it.each(bounceSenders)(
  'sends nothing when Reply answers a $provider bounce addressed only to me',
  async ({ provider, from }) => {
    expect(
      await sendReply(provider, from, [{ email: 'me@example.com' }])
    ).toEqual([]);
  }
);
